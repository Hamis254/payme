import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';

// Simple products catalog for a business
// Example: "Sugar", "Cooking Oil", "Rice"
// Tracks basic product info with current quantity and prices
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  // Product name
  name: varchar('name', { length: 255 }).notNull(),
  // Optional stock-keeping unit code — free text, only meaningful once a
  // business has grown enough to want it. Not unique-constrained: two
  // products both left blank must not collide.
  sku: varchar('sku', { length: 100 }),
  // Free-text unit of measure — "bundle", "kg", "crate", "piece", whatever
  // matches how the owner actually talks about the item. Defaults to
  // "pcs" so existing rows and quick-add flows don't need to specify one.
  unit: varchar('unit', { length: 50 }).notNull().default('pcs'),
  // Optional — only products that actually expire (perishables, some
  // digital license-style goods) set this. Checked lazily on stock list
  // fetch to auto-move expired quantity into spoiled_stock.
  expiry_date: timestamp('expiry_date'),
  // Current quantity in stock
  current_quantity: decimal('current_quantity', {
    precision: 12,
    scale: 3,
  })
    .notNull()
    .default('0'),
  // Units physically on the shelf but already promised to an open hire
  // purchase agreement — HP goods don't leave stock until the agreement is
  // paid off, so they must not be sellable in the meantime.
  // sellable = current_quantity − reserved_quantity.
  //
  // This lived on stockMovements by mistake (pasted under a comment that
  // said "add to products table"). products.reserved_quantity was therefore
  // undefined, which made drizzle throw on every analytics dashboard call
  // and made stock.service.js's reservation writes silently no-op.
  reserved_quantity: decimal('reserved_quantity', {
    precision: 12,
    scale: 3,
  })
    .notNull()
    .default('0'),
  // Per-product reorder point — defaults to 5 to match the existing
  // hardcoded LOW_STOCK_FLOOR credit.service.js already assumes.
  low_stock_threshold: decimal('low_stock_threshold', {
    precision: 12,
    scale: 3,
  })
    .notNull()
    .default('5'),
  // Buying price per unit
  buying_price_per_unit: decimal('buying_price_per_unit', {
    precision: 12,
    scale: 2,
  }).notNull(),
  // Selling price per unit
  selling_price_per_unit: decimal('selling_price_per_unit', {
    precision: 12,
    scale: 2,
  }).notNull(),
  // Track if product is active
  is_active: integer('is_active').notNull().default(1),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// Stock movements log every change to inventory
// Types: 'purchase' (restock), 'sale', 'adjustment'
export const stockMovements = pgTable('stock_movements', {
  id: serial('id').primaryKey(),
  product_id: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  // Type of movement: 'purchase', 'sale', 'adjustment'
  type: varchar('type', { length: 50 }).notNull(),
  // Quantity change: positive for incoming (purchase, adjustment+), negative for outgoing (sale)
  quantity_change: decimal('quantity_change', {
    precision: 12,
    scale: 3,
  }).notNull(),
  // Cost/value per unit for this movement
  unit_cost: decimal('unit_cost', { precision: 12, scale: 2 }),
  // Reference to related record (e.g., sale_id for sales)
  reference_type: varchar('reference_type', { length: 50 }), // 'sale', 'manual', etc.
  reference_id: integer('reference_id'),
  // For sale movements that consume a purchase batch, link to that purchase movement id
  batch_id: integer('batch_id'),
  // Remaining quantity for purchase batches (used by FIFO deduction)
  remaining_quantity: decimal('remaining_quantity', {
    precision: 12,
    scale: 3,
  }),
  // Reason/note
  reason: text('reason'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});