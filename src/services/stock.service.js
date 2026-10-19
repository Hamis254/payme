import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { products, stockMovements } from '#models/stock.model.js';
import { businesses } from '#models/setting.model.js';
import { eq, and, lt, sql } from 'drizzle-orm';
import { recordSpoilage } from '#services/spoiledStock.service.js';
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

// ============ EXPIRY SWEEP ============

/**
 * Lazily moves any product whose expiry_date has passed into spoiled_stock.
 * Called at the top of every list/inventory read so expired stock never
 * shows as sellable without needing a cron job or background worker.
 * Products with no expiry_date are untouched (lt() against a NULL column
 * never matches, so they're naturally excluded).
 * Failures here are logged but never thrown — a broken sweep must not
 * block the stock list from loading.
 */
export const sweepExpiredProducts = async businessId => {
  try {
    const expired = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.business_id, businessId),
          eq(products.is_active, 1),
          lt(products.expiry_date, new Date())
        )
      );

    for (const product of expired) {
      const qty = Number(product.current_quantity) || 0;
      if (qty <= 0) continue;

      try {
        await recordSpoilage(
          businessId,
          product.id,
          qty,
          'expiration',
          'Automatically moved to spoiled stock — expiry date passed',
          'Auto-detected on stock list load',
          null,
          'auto_expiry',
          null
        );
        logger.info(
          `Auto-expired ${qty} units of ${product.name} (product ${product.id}) into spoiled stock`
        );
      } catch (e) {
        // Don't let one bad product block the rest of the sweep or the
        // caller's list fetch.
        logger.error('Failed to auto-expire product', {
          productId: product.id,
          error: e.message,
        });
      }
    }
  } catch (e) {
    logger.error('Error sweeping expired products', e);
  }
};

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
        unit: data.unit || 'pcs',
        sku: data.sku || null,
        expiry_date: data.expiry_date ? new Date(data.expiry_date) : null,
      })
      .returning();

    logger.info(
      `Product ${product.name} created for business ${data.business_id}`
    );
    return product;
  } catch (e) {
    logger.error('Error creating product', e);
    throw e;
  }
};

export const getProductsForBusiness = async (
  userId,
  businessId,
  { limit = 20, offset = 0 } = {}
) => {
  try {
    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    await sweepExpiredProducts(businessId);

    const [{ total }] = await db
      .select({ total: sql`count(*)`.mapWith(Number) })
      .from(products)
      .where(eq(products.business_id, businessId));

    const rows = await db
      .select()
      .from(products)
      .where(eq(products.business_id, businessId))
      .orderBy(products.created_at)
      .limit(limit)
      .offset(offset);

    return {
      products: rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
    };
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
    if (updateData.expiry_date !== undefined) {
      updateData.expiry_date = updateData.expiry_date
        ? new Date(updateData.expiry_date)
        : null;
    }
    if (updateData.buying_price_per_unit !== undefined) {
      updateData.buying_price_per_unit = String(updateData.buying_price_per_unit);
    }
    if (updateData.selling_price_per_unit !== undefined) {
      updateData.selling_price_per_unit = String(updateData.selling_price_per_unit);
    }

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
      unit_cost: String(
        data.buying_price_per_unit || product.buying_price_per_unit
      ),
      reference_type: 'purchase',
      // initialize remaining_quantity for FIFO tracking
      remaining_quantity: String(data.quantity),
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
 * Deduct stock for a sale (naive, non-FIFO).
 * NOTE: not used anywhere in the app — sales.controller.js uses
 * deductStockFIFO() below instead, which is transaction-aware and
 * batch-costed. Kept only in case something needs a simple decrement
 * outside the sales flow later.
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
 * Check if sufficient SELLABLE stock is available.
 * "Sellable" excludes anything already reserved for an open hire
 * purchase agreement — those goods are spoken for even though they
 * haven't been FIFO-deducted yet.
 */
export const checkStockAvailability = async (productId, quantity, trx = null) => {
  try {
    const client = trx || db;
    const [product] = await client
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) throw new Error('Product not found');

    const onHand = Number(product.current_quantity) || 0;
    const reserved = Number(product.reserved_quantity) || 0;
    const sellable = onHand - reserved;

    return {
      available: sellable >= quantity,
      total_available: sellable,
      on_hand: onHand,
      reserved,
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
 * Reserve stock — held, not sellable, but NOT deducted from
 * current_quantity and NOT touching FIFO batches. The item is still
 * physically in the shop; it's just off-limits to every other sale until
 * the thing holding it (a hire purchase agreement, or an in-flight M-Pesa
 * STK push) resolves.
 *
 * The availability check and the increment are ONE conditional UPDATE, not
 * a read followed by a write. That difference is the whole point: the old
 * read-then-write version was a lost update. Two concurrent STK pushes for
 * the last unit both read reserved=0, both saw it as available, and both
 * wrote reserved=1 — so the shop promised the same unit to two customers
 * and whichever callback landed second oversold. Postgres serialises row
 * writes, so with the guard inside the WHERE clause the second caller's
 * update simply matches zero rows and it fails loudly instead.
 *
 * `options` lets non-HP callers label their hold correctly:
 *   - referenceType: 'hire_purchase_agreement' (default) | 'mpesa_attempt' | …
 *   - referenceId:   id of that thing, for tracing a hold back to its owner
 *   - reason:        overrides the default movement note
 */
export const reserveStockFIFO = async (
  productId,
  quantity,
  trx = null,
  options = {}
) => {
  try {
    const client = trx || db;
    const {
      referenceType = 'hire_purchase_agreement',
      referenceId = null,
      reason = null,
    } = options;

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid reservation quantity: ${quantity}`);
    }

    const [updated] = await client
      .update(products)
      .set({
        reserved_quantity: sql`${products.reserved_quantity} + ${String(qty)}::numeric`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(products.id, productId),
          sql`(${products.current_quantity} - ${products.reserved_quantity}) >= ${String(qty)}::numeric`
        )
      )
      .returning({
        id: products.id,
        name: products.name,
        reserved_quantity: products.reserved_quantity,
      });

    // Zero rows matched: either the product doesn't exist, or someone else
    // took the stock between this caller deciding to sell and getting here.
    // Re-read purely to tell the user which of the two it was.
    if (!updated) {
      const [product] = await client
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      if (!product) throw new Error('Product not found');

      const onHand = Number(product.current_quantity) || 0;
      const reserved = Number(product.reserved_quantity) || 0;
      throw new Error(
        `Insufficient sellable stock for ${product.name}. ` +
          `On hand: ${onHand}, already reserved: ${reserved}, requested: ${qty}`
      );
    }

    const newReserved = Number(updated.reserved_quantity);

    await client.insert(stockMovements).values({
      product_id: productId,
      type: 'reservation',
      quantity_change: '0', // nothing physically moved — see reserved_quantity for the hold
      reference_type: referenceType,
      reference_id: referenceId,
      reason:
        reason ||
        `Reserved ${qty} units for hire purchase — held until fully paid`,
    });

    logger.info(`Stock reserved: ${qty} units of product ${productId} (total reserved: ${newReserved})`);

    return { product_id: productId, quantity_reserved: qty, total_reserved: newReserved };
  } catch (e) {
    logger.error('Error reserving stock', e);
    throw e;
  }
};

/**
 * Release a reservation — called the moment an HP agreement is fully
 * paid (right after the real FIFO deduction runs), if an agreement is
 * cancelled before completion, or when an M-Pesa STK push fails or times
 * out. Never lets reserved_quantity go negative, even if called twice by
 * mistake.
 *
 * Like reserveStockFIFO, the subtraction is done in SQL rather than
 * read-modify-write, so two releases landing at once (a late callback
 * racing the timeout sweep) can't each read the same starting value and
 * one of them silently lose. GREATEST(…, 0) keeps the floor.
 *
 * `options` mirrors reserveStockFIFO — see there.
 */
export const releaseStockReservation = async (
  productId,
  quantity,
  trx = null,
  options = {}
) => {
  try {
    const client = trx || db;
    const {
      referenceType = 'hire_purchase_agreement',
      referenceId = null,
      reason = null,
    } = options;

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid release quantity: ${quantity}`);
    }

    const [updated] = await client
      .update(products)
      .set({
        reserved_quantity: sql`GREATEST(${products.reserved_quantity} - ${String(qty)}::numeric, 0)`,
        updated_at: new Date(),
      })
      .where(eq(products.id, productId))
      .returning({
        id: products.id,
        reserved_quantity: products.reserved_quantity,
      });

    if (!updated) throw new Error('Product not found');

    const newReserved = Number(updated.reserved_quantity);

    await client.insert(stockMovements).values({
      product_id: productId,
      type: 'reservation_release',
      quantity_change: '0',
      reference_type: referenceType,
      reference_id: referenceId,
      reason:
        reason ||
        `Released reservation of ${qty} units — agreement completed or cancelled`,
    });

    logger.info(`Stock reservation released: ${qty} units of product ${productId} (remaining reserved: ${newReserved})`);

    return { product_id: productId, quantity_released: qty, total_reserved: newReserved };
  } catch (e) {
    logger.error('Error releasing stock reservation', e);
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
      sku: product.sku,
      unit: product.unit,
      expiry_date: product.expiry_date,
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
 * Get full inventory summary for all products in a business, paginated.
 * This is the data source for the Stock page's zebra table — it already
 * carries per-product profit figures alongside business-wide totals.
 */
export const getFullInventoryForBusiness = async (
  userId,
  businessId,
  { limit = 20, offset = 0 } = {}
) => {
  try {
    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    await sweepExpiredProducts(businessId);

    // Business-wide totals are computed across ALL products, not just the
    // current page — otherwise "total potential profit" would silently
    // shrink to whatever fits on page 1.
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
      pagination: {
        total: allProducts.length,
        limit,
        offset,
        hasMore: offset + limit < allProducts.length,
      },
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
        sku: product.sku,
        unit: product.unit,
        expiry_date: product.expiry_date,
        current_quantity: qty,
        buying_price_per_unit: buyingPrice,
        selling_price_per_unit: sellingPrice,
        cost_value: costValue,
        selling_value: sellingValue,
        profit_per_unit: profitPerUnit,
        potential_profit: potentialProfit,
        is_active: Boolean(product.is_active),
        created_at: product.created_at,
      });
    }

    // Slice to the requested page only after totals are computed —
    // pagination.products should be a window into the full sorted list.
    summary.products = summary.products
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(offset, offset + limit);

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
export const deductStockFIFO = async (productId, quantity, trx = null) => {
  try {
    const client = trx || db;

    const [product] = await client
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) throw new Error('Product not found');

    const currentQty = Number(product.current_quantity) || 0;
    const reservedQty = Number(product.reserved_quantity) || 0;
    const sellableQty = currentQty - reservedQty;

    if (sellableQty < quantity) {
      throw new Error(
        `Insufficient sellable stock for ${product.name}. On hand: ${currentQty}, reserved: ${reservedQty}, sellable: ${sellableQty}, requested: ${quantity}`
      );
    }

    // Get all purchase movements in FIFO order (oldest first)
    const purchases = await client
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

      const availableQty =
        typeof purchase.remaining_quantity !== 'undefined' &&
        purchase.remaining_quantity !== null
          ? Number(purchase.remaining_quantity)
          : Number(purchase.quantity_change) || 0;
      const unitCost = Number(purchase.unit_cost) || 0;

      if (availableQty > 0) {
        const deductQty = Math.min(remainingQty, availableQty);

        deductions.push({
          batch_id: purchase.id,
          quantity: deductQty,
          unit_cost: unitCost,
          total_cost: deductQty * unitCost,
          purchase_date: purchase.created_at,
        });

        try {
          const newRemaining = Number((availableQty - deductQty).toFixed(3));
          await client
            .update(stockMovements)
            .set({ remaining_quantity: String(newRemaining) })
            .where(eq(stockMovements.id, purchase.id));
        } catch (uErr) {
          logger.error('Failed to update purchase remaining_quantity', uErr);
        }

        remainingQty -= deductQty;
      }
    }

    if (remainingQty > 0) {
      const unitCost = Number(product.buying_price_per_unit) || 0;
      deductions.push({
        batch_id: null,
        quantity: remainingQty,
        unit_cost: unitCost,
        total_cost: remainingQty * unitCost,
        purchase_date: new Date(),
      });
    }

    const newQty = currentQty - quantity;
    await client
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
      deductions,
    };
  } catch (e) {
    logger.error('Error deducting stock FIFO', e);
    throw e;
  }
};

/**
 * Re-fetches a product's current state after a deduction and fires a
 * lowStock notification if it's at/below its threshold. Deliberately
 * re-queries rather than trusting deductStockFIFO's return value, since
 * this is called post-transaction-commit in some call sites and the
 * caller shouldn't have to thread FIFO deduction internals through.
 * Never throws — a notification failure must not fail the sale.
 */
export const checkAndNotifyLowStock = async (businessId, productId) => {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) return;

    const currentQty = Number(product.current_quantity) || 0;
    const threshold = Number(product.low_stock_threshold) || 5;
    if (currentQty > threshold) return;

    const [business] = await db
      .select({ user_id: businesses.user_id })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);

    if (!business) return;

    await emitNotification({
      user_id: business.user_id,
      business_id: businessId,
      ...notifications.lowStock({
        product_name: product.name,
        quantity: currentQty,
        product_id: productId,
      }),
    });
  } catch (e) {
    logger.error('checkAndNotifyLowStock failed (non-fatal)', e);
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

    await db
      .update(products)
      .set({
        current_quantity: String(newQty),
        updated_at: new Date(),
      })
      .where(eq(products.id, data.product_id));

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