/**
 * =============================================================================
 * SPOILED STOCK MODEL: Track damaged, expired, and lost inventory items
 * =============================================================================
 * Tracks spoilage incidents for financial reporting, loss analysis, and
 * pattern identification to help businesses mitigate future losses.
 *
 * Key use cases:
 * - Transportation damage (goods damaged in transit)
 * - Expiration (products past sell-by date)
 * - Storage issues (improper conditions, moisture, pests)
 * - Handling accidents (dropped, contaminated)
 * - Theft/loss (missing inventory)
 *
 * @module models/spoiledStock.model
 */

import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';
import { products } from '#models/stock.model.js';

/**
 * SPOILED STOCK TABLE
 * Records every spoilage incident with product, quantity, reason, and date
 * Enables businesses to identify patterns (e.g., recurring supplier issues)
 */
export const spoiledStock = pgTable(
  'spoiled_stock',
  {
    id: serial('id').primaryKey(),

    // Business reference
    business_id: integer('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),

    // Product reference
    product_id: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    // Quantity spoiled (in product units)
    quantity_spoiled: decimal('quantity_spoiled', {
      precision: 12,
      scale: 3,
    }).notNull(),

    // Unit cost of spoiled item (for loss calculation)
    // Captures the buying price at time of spoilage for accurate P&L
    unit_cost: decimal('unit_cost', {
      precision: 12,
      scale: 2,
    }).notNull(),

    // Total loss value (quantity_spoiled * unit_cost)
    total_loss_value: decimal('total_loss_value', {
      precision: 14,
      scale: 2,
    }).notNull(),

    // Type of spoilage
    // Values: 'expiration', 'damage', 'storage', 'handling', 'theft', 'other'
    spoilage_type: varchar('spoilage_type', { length: 50 }).notNull(),

    // Detailed reason (user-entered)
    // Examples: "Dropped during unloading", "Exposed to moisture", "Supplier delivered damaged"
    reason: text('reason').notNull(),

    // Notes/additional context
    notes: text('notes'),

    // Optional reference to related operation
    // If spoilage discovered during stock count, record reference
    reference_type: varchar('reference_type', { length: 50 }), // 'stock_count', 'delivery_check', 'manual'
    reference_id: integer('reference_id'),

    // Tracking
    created_by: integer('created_by'), // User who recorded spoilage
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull(),
  },
  table => ({
    // Indexes for efficient queries
    businessIdx: index('spoiled_stock_business_idx').on(table.business_id),
    productIdx: index('spoiled_stock_product_idx').on(table.product_id),
    typeIdx: index('spoiled_stock_type_idx').on(table.spoilage_type),
    dateIdx: index('spoiled_stock_date_idx').on(table.created_at),
  })
);

/**
 * SPOILAGE ANALYTICS VIEW (calculated on-the-fly)
 * Helps businesses identify patterns and trends
 *
 * Useful queries:
 * - Most spoiled products (by frequency)
 * - Highest loss products (by value)
 * - Common spoilage types
 * - Monthly spoilage trends
 * - Supplier-specific damage rates
 */
export const spoilageAnalytics = {
  // Get top 10 most spoiled products (by quantity)
  topSpoiledByQuantity: `
    SELECT 
      p.id,
      p.name,
      COUNT(*) as incident_count,
      SUM(CAST(ss.quantity_spoiled AS DECIMAL)) as total_quantity,
      SUM(CAST(ss.total_loss_value AS DECIMAL)) as total_loss
    FROM spoiled_stock ss
    JOIN products p ON ss.product_id = p.id
    WHERE ss.business_id = $1
    GROUP BY p.id, p.name
    ORDER BY total_quantity DESC
    LIMIT 10
  `,

  // Get top 10 losses by value (helps identify high-impact items)
  topLossesByValue: `
    SELECT 
      p.id,
      p.name,
      COUNT(*) as incident_count,
      SUM(CAST(ss.quantity_spoiled AS DECIMAL)) as total_quantity,
      SUM(CAST(ss.total_loss_value AS DECIMAL)) as total_loss
    FROM spoiled_stock ss
    JOIN products p ON ss.product_id = p.id
    WHERE ss.business_id = $1
    GROUP BY p.id, p.name
    ORDER BY total_loss DESC
    LIMIT 10
  `,

  // Get spoilage by type (distribution analysis)
  byType: `
    SELECT 
      spoilage_type,
      COUNT(*) as incident_count,
      SUM(CAST(quantity_spoiled AS DECIMAL)) as total_quantity,
      SUM(CAST(total_loss_value AS DECIMAL)) as total_loss
    FROM spoiled_stock
    WHERE business_id = $1
    GROUP BY spoilage_type
    ORDER BY total_loss DESC
  `,

  // Monthly trend (identify seasonal patterns)
  monthlyTrend: `
    SELECT 
      DATE_TRUNC('month', created_at) as month,
      COUNT(*) as incident_count,
      SUM(CAST(quantity_spoiled AS DECIMAL)) as total_quantity,
      SUM(CAST(total_loss_value AS DECIMAL)) as total_loss
    FROM spoiled_stock
    WHERE business_id = $1
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month DESC
  `,

  // Spoilage rate (quantity spoiled vs. avg stock level) - for risk assessment
  spoilageRate: `
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
    WHERE ss.business_id = $1
    GROUP BY p.id, p.name
    ORDER BY spoilage_rate_percent DESC
  `,
};

/**
 * SPOILAGE TYPES
 * Standard categories to help with reporting and pattern analysis
 */
export const SPOILAGE_TYPES = {
  EXPIRATION: 'expiration', // Goods past sell-by/best-before date
  DAMAGE: 'damage', // Physical damage (broken packaging, dents, leaks)
  STORAGE: 'storage', // Storage conditions (moisture, temperature, pests)
  HANDLING: 'handling', // Handling accidents (dropped, crushed, contaminated)
  THEFT: 'theft', // Missing/stolen inventory
  OTHER: 'other', // Miscellaneous
};
