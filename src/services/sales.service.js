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

// Validate cart items and calculate totals before creating sale
export const validateAndCalculateCart = async (userId, businessId, items) => {
  try {
    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const validatedItems = [];
    let totalAmount = 0;

    for (const item of items) {
      // Validate product exists and belongs to business
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

      // Check stock availability
      const stockCheck = await checkStockAvailability(
        item.product_id,
        item.quantity
      );

      if (!stockCheck.available) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${stockCheck.total_available} ${product.unit}, Requested: ${item.quantity} ${product.unit}`
        );
      }

      // Use product's selling price per unit
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

// Create a sale and deduct stock
export const createSale = async (
  userId,
  businessId,
  items,
  paymentMode,
  options = {}
) => {
  try {
    // Validate cart first
    const cartValidation = await validateAndCalculateCart(
      userId,
      businessId,
      items
    );

    // Process each item: deduct stock and calculate actual profit
    const processedItems = [];
    let totalProfit = 0;

    for (const item of items) {
      // Deduct stock using FIFO for accurate profit calculation
      // This uses the batch cost from purchase movements
      const deduction = await deductStockFIFO(item.product_id, item.quantity);

      // Get the validated item info
      const validatedItem = cartValidation.items.find(
        i => i.product_id === item.product_id
      );

      // Calculate profit using actual FIFO cost
      const totalDeductionCost = deduction.deductions.reduce(
        (sum, d) => sum + d.total_cost,
        0
      );
      const totalPrice = validatedItem.unit_price * item.quantity;
      const profit = totalPrice - totalDeductionCost;

      // Calculate average unit cost from FIFO deductions
      const avgUnitCost = deduction.deductions.length > 0
        ? totalDeductionCost / item.quantity
        : 0;

      processedItems.push({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: validatedItem.unit_price,
        total_price: Number(totalPrice.toFixed(2)),
        unit_cost: avgUnitCost,
        profit: Number(profit.toFixed(2)),
        product_name: validatedItem.product_name,
      });

      // Log stock movement for each FIFO deduction batch
      for (const d of deduction.deductions) {
        await db.insert(stockMovements).values({
          product_id: item.product_id,
          batch_id: d.batch_id,
          type: 'sale',
          quantity_change: String(-d.quantity),
          unit_cost: String(d.unit_cost),
          reference_type: 'sale',
          reason: `Sale - FIFO batch ${d.batch_id || 'current'}`,
        });
      }

      totalProfit += profit;
    }

    // Create the sale record
    const [sale] = await db
      .insert(sales)
      .values({
        business_id: businessId,
        total_amount: String(cartValidation.total_amount),
        total_profit: String(totalProfit.toFixed(2)),
        payment_mode: paymentMode,
        status: paymentMode === 'cash' ? 'completed' : 'pending',
        customer_type: options.customer_type || 'walk_in',
        customer_id: options.customer_id,
        note: options.note,
        mpesa_sender_phone: options.customer_phone,
      })
      .returning();

    // Create sale items
    for (const item of processedItems) {
      await db.insert(saleItems).values({
        sale_id: sale.id,
        product_id: item.product_id,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
        total_price: String(item.total_price),
        unit_cost: String(item.unit_cost),
        profit: String(item.profit),
      });
    }

    // Update stock movement references with sale ID
    // (This is a simplified approach; in production you'd do this in transaction)

    logger.info(
      `Sale created: ${sale.id} for business ${businessId}, total: ${cartValidation.total_amount}, profit: ${totalProfit.toFixed(2)}`
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
        total_profit: Number(totalProfit.toFixed(2)),
        profit_margin_percent: Number(
          ((totalProfit / cartValidation.total_amount) * 100).toFixed(2)
        ),
      },
    };
  } catch (e) {
    logger.error('Error creating sale', e);
    throw e;
  }
};

// Update sale status (for MPESA callback)
export const updateSaleStatus = async (saleId, status, mpesaData = {}) => {
  try {
    const updateData = {
      status,
      updated_at: new Date(),
    };

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

// Get sales for a business
export const getSalesForBusiness = async (userId, businessId, options = {}) => {
  try {
    // Verify user owns the business
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

    // Calculate totals
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

// Get sale details with items
export const getSaleById = async (userId, saleId) => {
  try {
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);

    if (!sale) throw new Error('Sale not found');

    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, sale.business_id), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!business) throw new Error('Sale not found or access denied');

    // Get sale items with product names
    const items = await db
      .select({
        id: saleItems.id,
        product_id: saleItems.product_id,
        product_name: products.name,
        unit: products.unit,
        quantity: saleItems.quantity,
        unit_price: saleItems.unit_price,
        total_price: saleItems.total_price,
        unit_cost: saleItems.unit_cost,
        profit: saleItems.profit,
      })
      .from(saleItems)
      .leftJoin(products, eq(saleItems.product_id, products.id))
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
