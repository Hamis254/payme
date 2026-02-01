import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { products, stockMovements } from '#models/stock.model.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';

// ============ PRODUCTS ============

export const createProduct = async (userId, data) => {
  try {
    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, data.business_id), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const [product] = await db
      .insert(products)
      .values({
        business_id: data.business_id,
        name: data.name,
        current_quantity: '0',
        buying_price_per_unit: String(data.buying_price_per_unit),
        selling_price_per_unit: String(data.selling_price_per_unit),
      })
      .returning();

    logger.info(`Product ${product.name} created for business ${data.business_id}`);
    return product;
  } catch (e) {
    logger.error('Error creating product', e);
    throw e;
  }
};

export const getProductsForBusiness = async (userId, businessId) => {
  try {
    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    return await db
      .select()
      .from(products)
      .where(eq(products.business_id, businessId));
  } catch (e) {
    logger.error('Error getting products', e);
    throw e;
  }
};

export const getProductById = async (userId, productId) => {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) throw new Error('Product not found');

    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(
          eq(businesses.id, product.business_id),
          eq(businesses.user_id, userId)
        )
      )
      .limit(1);

    if (!business) throw new Error('Product not found or access denied');

    return product;
  } catch (e) {
    logger.error('Error getting product', e);
    throw e;
  }
};

export const updateProduct = async (userId, productId, updates) => {
  try {
    await getProductById(userId, productId);

    const updateData = { ...updates, updated_at: new Date() };

    const [updated] = await db
      .update(products)
      .set(updateData)
      .where(eq(products.id, productId))
      .returning();

    logger.info(`Product ${updated.id} updated`);
    return updated;
  } catch (e) {
    logger.error('Error updating product', e);
    throw e;
  }
};

// ============ STOCK OPERATIONS ============

/**
 * Add stock (restock) for a product
 * Updates current_quantity and logs movement
 */
export const addStock = async (userId, data) => {
  try {
    const product = await getProductById(userId, data.product_id);

    // Update product quantity
    const currentQty = Number(product.current_quantity) || 0;
    const newQty = currentQty + Number(data.quantity);

    await db
      .update(products)
      .set({
        current_quantity: String(newQty),
        updated_at: new Date(),
      })
      .where(eq(products.id, data.product_id));

    // Log stock movement
    await db.insert(stockMovements).values({
      product_id: data.product_id,
      type: 'purchase',
      quantity_change: String(data.quantity),
      unit_cost: String(data.buying_price_per_unit || product.buying_price_per_unit),
      reference_type: 'purchase',
      reason: data.note || 'Stock purchase',
    });

    logger.info(
      `Stock added: ${data.quantity} units of ${product.name} (new total: ${newQty})`
    );

    return {
      product_id: data.product_id,
      product_name: product.name,
      quantity_added: data.quantity,
      new_total_quantity: newQty,
      buying_price_per_unit: product.buying_price_per_unit,
      selling_price_per_unit: product.selling_price_per_unit,
    };
  } catch (e) {
    logger.error('Error adding stock', e);
    throw e;
  }
};

/**
 * Deduct stock for a sale
 * Automatically decrements current_quantity
 */
export const deductStock = async (productId, quantity) => {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) throw new Error('Product not found');

    const currentQty = Number(product.current_quantity) || 0;
    if (currentQty < quantity) {
      throw new Error(
        `Insufficient stock for ${product.name}. Available: ${currentQty}, Requested: ${quantity}`
      );
    }

    const newQty = currentQty - quantity;

    // Update product quantity
    await db
      .update(products)
      .set({
        current_quantity: String(newQty),
        updated_at: new Date(),
      })
      .where(eq(products.id, productId));

    logger.info(
      `Stock deducted: ${quantity} units of ${product.name} (new total: ${newQty})`
    );

    return {
      product_id: productId,
      product_name: product.name,
      quantity_deducted: quantity,
      new_total_quantity: newQty,
      buying_price_per_unit: product.buying_price_per_unit,
      selling_price_per_unit: product.selling_price_per_unit,
    };
  } catch (e) {
    logger.error('Error deducting stock', e);
    throw e;
  }
};

/**
 * Check if sufficient stock is available
 */
export const checkStockAvailability = async (productId, quantity) => {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) throw new Error('Product not found');

    const available = Number(product.current_quantity) || 0;

    return {
      available: available >= quantity,
      total_available: available,
      requested: quantity,
      product_id: productId,
      product_name: product.name,
    };
  } catch (e) {
    logger.error('Error checking stock availability', e);
    throw e;
  }
};

/**
 * Get inventory details for a product
 */
export const getInventoryForProduct = async (userId, productId) => {
  try {
    const product = await getProductById(userId, productId);

    // Get movement history
    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.product_id, productId));

    const totalPurchased = movements
      .filter(m => m.type === 'purchase')
      .reduce((sum, m) => sum + Number(m.quantity_change), 0);

    const totalSold = movements
      .filter(m => m.type === 'sale')
      .reduce((sum, m) => sum + Math.abs(Number(m.quantity_change)), 0);

    const totalAdjustments = movements
      .filter(m => m.type === 'adjustment')
      .reduce((sum, m) => sum + Number(m.quantity_change), 0);

    const current = Number(product.current_quantity) || 0;
    const buyingPrice = Number(product.buying_price_per_unit);
    const sellingPrice = Number(product.selling_price_per_unit);
    const profitPerUnit = sellingPrice - buyingPrice;
    const marginPercent = ((profitPerUnit / buyingPrice) * 100).toFixed(2);

    return {
      product_id: product.id,
      product_name: product.name,
      current_quantity: current,
      buying_price_per_unit: buyingPrice,
      selling_price_per_unit: sellingPrice,
      profit_per_unit: profitPerUnit,
      profit_margin_percent: Number(marginPercent),
      potential_profit_if_sold: Number((current * profitPerUnit).toFixed(2)),
      history: {
        total_purchased: totalPurchased,
        total_sold: totalSold,
        total_adjustments: totalAdjustments,
        movements,
      },
    };
  } catch (e) {
    logger.error('Error getting product inventory', e);
    throw e;
  }
};

/**
 * Get full inventory summary for all products in a business
 */
export const getFullInventoryForBusiness = async (userId, businessId) => {
  try {
    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const allProducts = await db
      .select()
      .from(products)
      .where(eq(products.business_id, businessId));

    const summary = {
      business_id: businessId,
      total_products: allProducts.length,
      total_units_in_stock: 0,
      total_value_at_cost: 0,
      total_value_at_selling: 0,
      potential_profit: 0,
      products: [],
    };

    for (const product of allProducts) {
      const qty = Number(product.current_quantity) || 0;
      const buyingPrice = Number(product.buying_price_per_unit);
      const sellingPrice = Number(product.selling_price_per_unit);
      const costValue = qty * buyingPrice;
      const sellingValue = qty * sellingPrice;
      const profitPerUnit = sellingPrice - buyingPrice;
      const potentialProfit = qty * profitPerUnit;

      summary.total_units_in_stock += qty;
      summary.total_value_at_cost += costValue;
      summary.total_value_at_selling += sellingValue;
      summary.potential_profit += potentialProfit;

      summary.products.push({
        id: product.id,
        name: product.name,
        current_quantity: qty,
        buying_price_per_unit: buyingPrice,
        selling_price_per_unit: sellingPrice,
        cost_value: costValue,
        selling_value: sellingValue,
        profit_per_unit: profitPerUnit,
        potential_profit: potentialProfit,
        is_active: Boolean(product.is_active),
      });
    }

    return summary;
  } catch (e) {
    logger.error('Error getting full inventory', e);
    throw e;
  }
};

/**
 * Deduct stock using FIFO method
 * Gets purchase movements in chronological order and deducts from oldest first
 * Returns array of deductions per batch/purchase for profit calculation
 */
export const deductStockFIFO = async (productId, quantity) => {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) throw new Error('Product not found');

    const currentQty = Number(product.current_quantity) || 0;
    if (currentQty < quantity) {
      throw new Error(
        `Insufficient stock for ${product.name}. Available: ${currentQty}, Requested: ${quantity}`
      );
    }

    // Get all purchase movements in FIFO order (oldest first)
    const purchases = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.product_id, productId),
          eq(stockMovements.type, 'purchase')
        )
      )
      .orderBy(stockMovements.created_at);

    const deductions = [];
    let remainingQty = quantity;

    // Deduct from each purchase batch until we've deducted enough
    for (const purchase of purchases) {
      if (remainingQty <= 0) break;

      const purchaseQty = Number(purchase.quantity_change) || 0;
      const unitCost = Number(purchase.unit_cost) || 0;

      if (purchaseQty > 0) {
        const deductQty = Math.min(remainingQty, purchaseQty);

        deductions.push({
          batch_id: purchase.id, // Use movement ID as batch ID
          quantity: deductQty,
          unit_cost: unitCost,
          total_cost: deductQty * unitCost,
          purchase_date: purchase.created_at,
        });

        remainingQty -= deductQty;
      }
    }

    // If we still need to deduct, use current purchase price as fallback
    if (remainingQty > 0) {
      const unitCost = Number(product.buying_price_per_unit) || 0;
      deductions.push({
        batch_id: null, // No specific batch
        quantity: remainingQty,
        unit_cost: unitCost,
        total_cost: remainingQty * unitCost,
        purchase_date: new Date(),
      });
    }

    // Update product quantity
    const newQty = currentQty - quantity;
    await db
      .update(products)
      .set({
        current_quantity: String(newQty),
        updated_at: new Date(),
      })
      .where(eq(products.id, productId));

    logger.info(
      `Stock deducted FIFO: ${quantity} units of ${product.name} (new total: ${newQty})`
    );

    return {
      product_id: productId,
      product_name: product.name,
      quantity_deducted: quantity,
      new_total_quantity: newQty,
      deductions, // Array of batch deductions for profit calc
    };
  } catch (e) {
    logger.error('Error deducting stock FIFO', e);
    throw e;
  }
};

/**
 * Record manual stock adjustment (correction, loss, etc.)
 */
export const recordAdjustment = async (userId, data) => {
  try {
    const product = await getProductById(userId, data.product_id);

    const currentQty = Number(product.current_quantity) || 0;
    const newQty = currentQty + Number(data.quantity_change);

    if (newQty < 0) {
      throw new Error(
        `Adjustment would result in negative quantity. Current: ${currentQty}, Change: ${data.quantity_change}`
      );
    }

    // Update product quantity
    await db
      .update(products)
      .set({
        current_quantity: String(newQty),
        updated_at: new Date(),
      })
      .where(eq(products.id, data.product_id));

    // Log movement
    await db.insert(stockMovements).values({
      product_id: data.product_id,
      type: 'adjustment',
      quantity_change: String(data.quantity_change),
      reference_type: 'manual',
      reason: data.reason,
    });

    logger.info(
      `Stock adjustment: ${data.quantity_change} units of ${product.name} (new total: ${newQty}). Reason: ${data.reason}`
    );

    return {
      product_id: data.product_id,
      product_name: product.name,
      adjustment: data.quantity_change,
      new_total_quantity: newQty,
      reason: data.reason,
    };
  } catch (e) {
    logger.error('Error recording adjustment', e);
    throw e;
  }
};
