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
  // Current quantity in stock
  current_quantity: decimal('current_quantity', {
    precision: 12,
    scale: 3,
  })
    .notNull()
    .default('0'),
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
  // Reason/note
  reason: text('reason'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});
