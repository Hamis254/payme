/**
 * =============================================================================
 * SPOILED STOCK SERVICE: Track and analyze inventory spoilage
 * =============================================================================
 * Handles recording spoilage incidents, calculating losses, and providing
 * analytics to help businesses identify patterns and mitigate future losses.
 *
 * @module services/spoiledStock.service
 */

import logger from '#config/logger.js';
import { db, sql } from '#config/database.js';
import { eq, and, desc, gte } from 'drizzle-orm';
import {
  spoiledStock,
  SPOILAGE_TYPES,
} from '#models/spoiledStock.model.js';
import { products } from '#models/stock.model.js';
import { stockMovements } from '#models/stock.model.js';

/**
 * RECORD SPOILAGE
 * Creates a spoilage record and updates product stock
 *
 * @param {number} businessId - Business ID
 * @param {number} productId - Product ID
 * @param {number} quantity - Quantity spoiled
 * @param {string} spoilageType - Type of spoilage (expiration, damage, storage, handling, theft, other)
 * @param {string} reason - Detailed reason
 * @param {string} [notes] - Additional notes
 * @param {number} [createdBy] - User ID who recorded spoilage
 * @param {string} [referenceType] - Type of reference (stock_count, delivery_check, manual)
 * @param {number} [referenceId] - Reference ID
 * @returns {Promise<Object>} Created spoilage record
 */
export const recordSpoilage = async (
  businessId,
  productId,
  quantity,
  spoilageType,
  reason,
  notes = null,
  createdBy = null,
  referenceType = null,
  referenceId = null
) => {
  try {
    // Validate spoilage type
    const validTypes = Object.values(SPOILAGE_TYPES);
    if (!validTypes.includes(spoilageType)) {
      throw new Error(
        `Invalid spoilage type. Must be one of: ${validTypes.join(', ')}`
      );
    }

    // Get product details for cost calculation
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.business_id, businessId)))
      .limit(1);

    if (!product) {
      throw new Error('Product not found or access denied');
    }

    if (Number(product.current_quantity) < Number(quantity)) {
      throw new Error(
        `Cannot spoil ${quantity} units. Only ${product.current_quantity} available.`
      );
    }

    // Calculate loss value
    const unitCost = Number(product.buying_price_per_unit);
    const totalLossValue = Number(quantity) * unitCost;

    // Atomic transaction: record spoilage and update stock
    const [createdSpoilage] = await db.transaction(async tx => {
      // Record spoilage incident
      const [spoilageRecord] = await tx
        .insert(spoiledStock)
        .values({
          business_id: businessId,
          product_id: productId,
          quantity_spoiled: String(quantity),
          unit_cost: String(unitCost),
          total_loss_value: String(totalLossValue),
          spoilage_type: spoilageType,
          reason,
          notes: notes || null,
          created_by: createdBy || null,
          reference_type: referenceType || null,
          reference_id: referenceId || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      // Update product stock (reduce by spoiled quantity)
      const newQuantity = Number(product.current_quantity) - Number(quantity);
      await tx
        .update(products)
        .set({
          current_quantity: String(newQuantity),
          updated_at: new Date(),
        })
        .where(eq(products.id, productId));

      // Log stock movement for audit trail
      await tx.insert(stockMovements).values({
        product_id: productId,
        type: 'spoilage',
        quantity_change: String(-quantity),
        unit_cost: String(unitCost),
        reference_type: 'spoilage',
        reference_id: spoilageRecord.id,
        reason: `Spoilage: ${spoilageType} - ${reason}`,
        created_at: new Date(),
      });

      return [spoilageRecord];
    });

    logger.info('Spoilage recorded', {
      business_id: businessId,
      product_id: productId,
      quantity_spoiled: quantity,
      loss_value: totalLossValue,
      spoilage_type: spoilageType,
    });

    return createdSpoilage;
  } catch (error) {
    logger.error('Error recording spoilage', {
      error: error.message,
      business_id: businessId,
      product_id: productId,
    });
    throw error;
  }
};

/**
 * GET SPOILAGE RECORD BY ID
 * @param {number} businessId
 * @param {number} spoilageId
 * @returns {Promise<Object>} Spoilage record with product details
 */
export const getSpoilageById = async (businessId, spoilageId) => {
  const [record] = await db
    .select({
      spoilage: spoiledStock,
      product: {
        id: products.id,
        name: products.name,
        buying_price: products.buying_price_per_unit,
        selling_price: products.selling_price_per_unit,
      },
    })
    .from(spoiledStock)
    .leftJoin(products, eq(spoiledStock.product_id, products.id))
    .where(
      and(eq(spoiledStock.id, spoilageId), eq(spoiledStock.business_id, businessId))
    )
    .limit(1);

  if (!record) {
    throw new Error('Spoilage record not found');
  }

  return {
    ...record.spoilage,
    product: record.product,
  };
};

/**
 * LIST SPOILAGE RECORDS
 * Get paginated list with optional filters
 *
 * @param {number} businessId
 * @param {Object} filters
 * @param {number} [filters.productId]
 * @param {string} [filters.spoilageType]
 * @param {Date} [filters.startDate]
 * @param {Date} [filters.endDate]
 * @param {number} [filters.limit=50]
 * @param {number} [filters.offset=0]
 * @returns {Promise<Array>} Spoilage records with product details
 */
export const listSpoilageRecords = async (
  businessId,
  {
    productId = null,
    spoilageType = null,
    startDate = null,
    endDate = null,
    limit = 50,
    offset = 0,
  } = {}
) => {
  let query = db
    .select({
      spoilage: spoiledStock,
      product: {
        id: products.id,
        name: products.name,
      },
    })
    .from(spoiledStock)
    .leftJoin(products, eq(spoiledStock.product_id, products.id))
    .where(eq(spoiledStock.business_id, businessId));

  // Apply filters
  if (productId) {
    query = query.where(eq(spoiledStock.product_id, productId));
  }

  if (spoilageType) {
    query = query.where(eq(spoiledStock.spoilage_type, spoilageType));
  }

  if (startDate) {
    query = query.where(gte(spoiledStock.created_at, startDate));
  }

  if (endDate) {
    query = query.where(gte(spoiledStock.created_at, endDate));
  }

  const records = await query
    .orderBy(desc(spoiledStock.created_at))
    .limit(limit)
    .offset(offset);

  return records.map(record => ({
    ...record.spoilage,
    product: record.product,
  }));
};

/**
 * GET SPOILAGE SUMMARY
 * Total spoilage incidents and loss value for business
 *
 * @param {number} businessId
 * @returns {Promise<Object>} Summary statistics
 */
export const getSpoilageSummary = async businessId => {
  const [summary] = await db
    .select({
      total_incidents: sql`COUNT(*)`.mapWith(Number),
      total_quantity: sql`SUM(CAST(${spoiledStock.quantity_spoiled} AS DECIMAL))`.mapWith(
        Number
      ),
      total_loss_value: sql`SUM(CAST(${spoiledStock.total_loss_value} AS DECIMAL))`.mapWith(
        Number
      ),
    })
    .from(spoiledStock)
    .where(eq(spoiledStock.business_id, businessId));

  return {
    total_incidents: summary.total_incidents || 0,
    total_quantity: summary.total_quantity || 0,
    total_loss_value: summary.total_loss_value || 0,
  };
};

/**
 * GET SPOILAGE BY TYPE
 * Breakdown of spoilage incidents by type
 *
 * @param {number} businessId
 * @returns {Promise<Array>} Array of {type, count, quantity, loss_value}
 */
export const getSpoilageByType = async businessId => {
  const result = await db.run(
    sql`
      SELECT 
        spoilage_type,
        COUNT(*) as incident_count,
        SUM(CAST(quantity_spoiled AS DECIMAL)) as total_quantity,
        SUM(CAST(total_loss_value AS DECIMAL)) as total_loss_value
      FROM spoiled_stock
      WHERE business_id = ${businessId}
      GROUP BY spoilage_type
      ORDER BY total_loss_value DESC
    `
  );

  return result.rows;
};

/**
 * GET TOP SPOILED PRODUCTS (by quantity)
 * Identify which products are most frequently spoiled
 *
 * @param {number} businessId
 * @param {number} [limit=10]
 * @returns {Promise<Array>} Top spoiled products
 */
export const getTopSpoiledProducts = async (businessId, limit = 10) => {
  const result = await db.run(
    sql`
      SELECT 
        p.id,
        p.name,
        COUNT(*) as incident_count,
        SUM(CAST(ss.quantity_spoiled AS DECIMAL)) as total_quantity,
        SUM(CAST(ss.total_loss_value AS DECIMAL)) as total_loss_value
      FROM spoiled_stock ss
      JOIN products p ON ss.product_id = p.id
      WHERE ss.business_id = ${businessId}
      GROUP BY p.id, p.name
      ORDER BY total_quantity DESC
      LIMIT ${limit}
    `
  );

  return result.rows;
};

/**
 * GET HIGHEST LOSS PRODUCTS (by value)
 * Identify which products cause highest financial loss
 *
 * @param {number} businessId
 * @param {number} [limit=10]
 * @returns {Promise<Array>} Products with highest losses
 */
export const getHighestLossProducts = async (businessId, limit = 10) => {
  const result = await db.run(
    sql`
      SELECT 
        p.id,
        p.name,
        COUNT(*) as incident_count,
        SUM(CAST(ss.quantity_spoiled AS DECIMAL)) as total_quantity,
        SUM(CAST(ss.total_loss_value AS DECIMAL)) as total_loss_value
      FROM spoiled_stock ss
      JOIN products p ON ss.product_id = p.id
      WHERE ss.business_id = ${businessId}
      GROUP BY p.id, p.name
      ORDER BY total_loss_value DESC
      LIMIT ${limit}
    `
  );

  return result.rows;
};

/**
 * GET MONTHLY SPOILAGE TREND
 * Identify seasonal patterns or trends
 *
 * @param {number} businessId
 * @returns {Promise<Array>} Monthly breakdown
 */
export const getMonthlySpoilageTrend = async businessId => {
  const result = await db.run(
    sql`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as incident_count,
        SUM(CAST(quantity_spoiled AS DECIMAL)) as total_quantity,
        SUM(CAST(total_loss_value AS DECIMAL)) as total_loss_value
      FROM spoiled_stock
      WHERE business_id = ${businessId}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `
  );

  return result.rows;
};

/**
 * CALCULATE SPOILAGE RATE
 * Helps identify high-risk products (those that spoil frequently)
 * Useful for inventory management decisions
 *
 * @param {number} businessId
 * @param {number} [limit=10]
 * @returns {Promise<Array>} Products with highest spoilage rates
 */
export const getHighestSpoilageRateProducts = async (businessId, limit = 10) => {
  const result = await db.run(
    sql`
      SELECT 
        p.id,
        p.name,
        COALESCE(p.current_quantity, 0) as current_quantity,
        COUNT(*) as incident_count,
        SUM(CAST(ss.quantity_spoiled AS DECIMAL)) as total_spoiled,
        ROUND(
          (SUM(CAST(ss.quantity_spoiled AS DECIMAL)) / 
           NULLIF(COALESCE(p.current_quantity, 0) + SUM(CAST(ss.quantity_spoiled AS DECIMAL)), 0)) * 100,
          2
        ) as spoilage_rate_percent
      FROM spoiled_stock ss
      JOIN products p ON ss.product_id = p.id
      WHERE ss.business_id = ${businessId}
      GROUP BY p.id, p.name
      ORDER BY spoilage_rate_percent DESC
      LIMIT ${limit}
    `
  );

  return result.rows;
};

/**
 * UPDATE SPOILAGE RECORD
 * Allows corrections/updates to spoilage records
 *
 * @param {number} businessId
 * @param {number} spoilageId
 * @param {Object} updates
 * @returns {Promise<Object>} Updated record
 */
export const updateSpoilageRecord = async (businessId, spoilageId, updates) => {
  // Verify ownership
  const [existing] = await db
    .select()
    .from(spoiledStock)
    .where(
      and(eq(spoiledStock.id, spoilageId), eq(spoiledStock.business_id, businessId))
    )
    .limit(1);

  if (!existing) {
    throw new Error('Spoilage record not found');
  }

  const [updated] = await db
    .update(spoiledStock)
    .set({
      ...updates,
      updated_at: new Date(),
    })
    .where(eq(spoiledStock.id, spoilageId))
    .returning();

  return updated;
};

/**
 * DELETE SPOILAGE RECORD
 * Remove spoilage record and restore stock if needed
 *
 * @param {number} businessId
 * @param {number} spoilageId
 */
export const deleteSpoilageRecord = async (businessId, spoilageId) => {
  const [spoilage] = await db
    .select()
    .from(spoiledStock)
    .where(
      and(eq(spoiledStock.id, spoilageId), eq(spoiledStock.business_id, businessId))
    )
    .limit(1);

  if (!spoilage) {
    throw new Error('Spoilage record not found');
  }

  // Atomic transaction: delete spoilage and restore stock
  await db.transaction(async tx => {
    // Delete spoilage record
    await tx
      .delete(spoiledStock)
      .where(eq(spoiledStock.id, spoilageId));

    // Restore stock quantity
    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, spoilage.product_id))
      .limit(1);

    if (product) {
      const restoredQuantity =
        Number(product.current_quantity) + Number(spoilage.quantity_spoiled);
      await tx
        .update(products)
        .set({
          current_quantity: String(restoredQuantity),
          updated_at: new Date(),
        })
        .where(eq(products.id, spoilage.product_id));
    }

    // Remove stock movement
    await tx
      .delete(stockMovements)
      .where(
        and(
          eq(stockMovements.reference_type, 'spoilage'),
          eq(stockMovements.reference_id, spoilageId)
        )
      );
  });

  logger.info('Spoilage record deleted', {
    business_id: businessId,
    spoilage_id: spoilageId,
  });
};
