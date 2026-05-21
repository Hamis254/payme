import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { sales, saleItems } from '#models/sales.model.js';
import { products, stockMovements } from '#models/stock.model.js';
import { businesses } from '#models/setting.model.js';
import { eq, and, desc } from 'drizzle-orm';
import {
  checkStockAvailability,
  deductStockFIFO,
} from '#services/stock.service.js';

/**
 * Validate cart items against the DB and calculate totals.
 * Prices are always read from DB — frontend never sends prices.
 */
export const validateAndCalculateCart = async (userId, businessId, items) => {
  try {
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const validatedItems = [];
    let totalAmount = 0;

    for (const item of items) {
      const [product] = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, item.product_id),
            eq(products.business_id, businessId)
          )
        )
        .limit(1);

      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      const stockCheck = await checkStockAvailability(
        item.product_id,
        item.quantity
      );

      if (!stockCheck.available) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${stockCheck.total_available}, Requested: ${item.quantity}`
        );
      }

      const unitPrice = Number(product.selling_price_per_unit);
      const lineTotal = unitPrice * item.quantity;

      validatedItems.push({
        product_id: item.product_id,
        product_name: product.name,
        unit: product.unit,
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: Number(lineTotal.toFixed(2)),
        stock_available: stockCheck.total_available,
      });

      totalAmount += lineTotal;
    }

    return {
      business,
      items: validatedItems,
      total_amount: Number(totalAmount.toFixed(2)),
      items_count: validatedItems.length,
    };
  } catch (e) {
    logger.error('Error validating cart', e);
    throw e;
  }
};

/**
 * Create a sale and handle stock deduction based on payment mode.
 *
 * Stock deduction rules:
 *   cash / credit / hire_purchase → deduct stock immediately (goods leave the shop)
 *   mpesa                         → create pending sale, deduct stock in callback
 *                                   after resultCode === 0
 *
 * For M-Pesa, unit_cost and profit on saleItems are set to 0 initially.
 * They are backfilled with real FIFO costs in the mpesaCallbackHandler.
 */
export const createSale = async (
  userId,
  businessId,
  items,
  paymentMode,
  options = {}
) => {
  try {
    const cartValidation = await validateAndCalculateCart(
      userId,
      businessId,
      items
    );

    const processedItems = [];
    let totalProfit = 0;

    for (const item of items) {
      const validatedItem = cartValidation.items.find(
        i => i.product_id === item.product_id
      );

      let avgUnitCost = 0;
      let profit = 0;

      if (
        paymentMode === 'cash' ||
        paymentMode === 'credit' ||
        paymentMode === 'hire_purchase'
      ) {
        // Goods leave the shop immediately — deduct stock via FIFO
        const deduction = await deductStockFIFO(item.product_id, item.quantity);

        const totalCost = deduction.deductions.reduce(
          (sum, d) => sum + d.total_cost,
          0
        );
        const totalPrice = validatedItem.unit_price * item.quantity;
        profit = totalPrice - totalCost;
        avgUnitCost =
          deduction.deductions.length > 0 ? totalCost / item.quantity : 0;

        // Log stock movements for immediate deductions
        for (const d of deduction.deductions) {
          await db.insert(stockMovements).values({
            product_id: item.product_id,
            batch_id: d.batch_id,
            type: 'sale',
            quantity_change: String(-d.quantity),
            unit_cost: String(d.unit_cost),
            reference_type: 'sale',
            reason: `${paymentMode} sale - FIFO batch ${d.batch_id || 'current'}`,
          });
        }
      } else {
        // M-Pesa: sale is pending — do NOT deduct stock yet
        // Stock will be deducted in mpesaCallbackHandler on resultCode === 0
        // unit_cost and profit will be backfilled at that point
        const totalPrice = validatedItem.unit_price * item.quantity;
        profit = 0; // Unknown until FIFO runs at callback
        avgUnitCost = 0; // Unknown until FIFO runs at callback
        // We still need totalProfit for the sale record; it'll be corrected in callback
        totalProfit += totalPrice; // Provisional revenue-only figure
      }

      processedItems.push({
        product_id: item.product_id,
        product_name: validatedItem.product_name,
        quantity: item.quantity,
        unit_price: validatedItem.unit_price,
        total_price: Number(
          (validatedItem.unit_price * item.quantity).toFixed(2)
        ),
        unit_cost: avgUnitCost,
        profit: Number(profit.toFixed(2)),
      });

      if (paymentMode !== 'mpesa') {
        totalProfit += profit;
      }
    }

    // For M-Pesa we set totalProfit to 0 — corrected in callback
    const finalTotalProfit = paymentMode === 'mpesa' ? 0 : totalProfit;

    // Create sale record
    const [sale] = await db
      .insert(sales)
      .values({
        business_id: businessId,
        total_amount: String(cartValidation.total_amount),
        total_profit: String(Number(finalTotalProfit.toFixed(2))),
        payment_mode: paymentMode,
        // Cash / credit / HP: goods are out → completed immediately
        // M-Pesa: awaiting payment confirmation → pending
        status: ['cash', 'credit', 'hire_purchase'].includes(paymentMode)
          ? 'completed'
          : 'pending',
        customer_type: options.customer_type || 'walk_in',
        customer_id: options.customer_id || null,
        note: options.note || null,
        mpesa_sender_phone: options.customer_phone || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    // Insert sale items (with product_name captured for historical accuracy)
    for (const item of processedItems) {
      await db.insert(saleItems).values({
        sale_id: sale.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
        total_price: String(item.total_price),
        unit_cost: String(item.unit_cost),
        profit: String(item.profit),
        created_at: new Date(),
      });
    }

    logger.info(
      `Sale created: ${sale.id} — business ${businessId}, mode: ${paymentMode}, total: ${cartValidation.total_amount}`
    );

    return {
      sale: {
        id: sale.id,
        business_id: sale.business_id,
        total_amount: Number(sale.total_amount),
        total_profit: Number(sale.total_profit),
        payment_mode: sale.payment_mode,
        status: sale.status,
        customer_type: sale.customer_type,
        created_at: sale.created_at,
      },
      items: processedItems,
      summary: {
        items_count: processedItems.length,
        total_amount: cartValidation.total_amount,
        total_profit: Number(finalTotalProfit.toFixed(2)),
        profit_margin_percent:
          paymentMode !== 'mpesa' && cartValidation.total_amount > 0
            ? Number(
              (
                (finalTotalProfit / cartValidation.total_amount) *
                  100
              ).toFixed(2)
            )
            : 0,
      },
    };
  } catch (e) {
    logger.error('Error creating sale', e);
    throw e;
  }
};

/**
 * Update sale status (used by M-Pesa callback utilities)
 */
export const updateSaleStatus = async (saleId, status, mpesaData = {}) => {
  try {
    const updateData = { status, updated_at: new Date() };

    if (mpesaData.transaction_id) {
      updateData.mpesa_transaction_id = mpesaData.transaction_id;
    }
    if (mpesaData.sender_name) {
      updateData.mpesa_sender_name = mpesaData.sender_name;
    }
    if (mpesaData.sender_phone) {
      updateData.mpesa_sender_phone = mpesaData.sender_phone;
    }

    const [updated] = await db
      .update(sales)
      .set(updateData)
      .where(eq(sales.id, saleId))
      .returning();

    logger.info(`Sale ${saleId} status updated to ${status}`);
    return updated;
  } catch (e) {
    logger.error('Error updating sale status', e);
    throw e;
  }
};

/**
 * Get all sales for a business (with totals)
 */
export const getSalesForBusiness = async (userId, businessId, options = {}) => {
  try {
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    let query = db
      .select()
      .from(sales)
      .where(eq(sales.business_id, businessId))
      .orderBy(desc(sales.created_at));

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const salesList = await query;

    let totalRevenue = 0;
    let totalProfit = 0;

    for (const sale of salesList) {
      if (sale.status === 'completed') {
        totalRevenue += Number(sale.total_amount);
        totalProfit += Number(sale.total_profit);
      }
    }

    return {
      sales: salesList,
      count: salesList.length,
      totals: {
        total_revenue: Number(totalRevenue.toFixed(2)),
        total_profit: Number(totalProfit.toFixed(2)),
      },
    };
  } catch (e) {
    logger.error('Error getting sales', e);
    throw e;
  }
};

/**
 * Get a single sale with all its items
 */
export const getSaleById = async (userId, saleId) => {
  try {
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);

    if (!sale) throw new Error('Sale not found');

    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, sale.business_id), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!business) throw new Error('Sale not found or access denied');

    const items = await db
      .select({
        id: saleItems.id,
        product_id: saleItems.product_id,
        product_name: saleItems.product_name,
        quantity: saleItems.quantity,
        unit_price: saleItems.unit_price,
        total_price: saleItems.total_price,
        unit_cost: saleItems.unit_cost,
        profit: saleItems.profit,
      })
      .from(saleItems)
      .where(eq(saleItems.sale_id, saleId));

    return {
      sale,
      items,
      business_name: business.name,
    };
  } catch (e) {
    logger.error('Error getting sale', e);
    throw e;
  }
};
