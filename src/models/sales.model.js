// sales.model.js
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
import { products } from '#models/stock.model.js';

/**
 * sales
 * - Keeps canonical sale records
 * - Includes MPESA/STK reconciliation fields, token fee, and payment status
 */
export const sales = pgTable('sales', {
  id: serial('id').primaryKey(),

  /* business that owns the sale */
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  /* monetary fields */
  total_amount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
  total_profit: decimal('total_profit', { precision: 12, scale: 2 }).notNull(),

  /* payment details */
  payment_mode: varchar('payment_mode', { length: 20 }).notNull(), // cash | mpesa | credit | hire_purchase
  token_fee: integer('token_fee').notNull().default(1),

  /* MPESA / STK reconciliation fields */
  stk_request_id: varchar('stk_request_id', { length: 128 }),
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }),
  mpesa_sender_name: varchar('mpesa_sender_name', { length: 255 }),
  mpesa_sender_phone: varchar('mpesa_sender_phone', { length: 20 }),
  amount_paid: decimal('amount_paid', { precision: 12, scale: 2 }),
  payment_status: varchar('payment_status', { length: 20 })
    .notNull()
    .default('pending'),
  callback_payload: text('callback_payload'),

  /* sale lifecycle and customer info */
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | completed | failed | cancelled
  customer_type: varchar('customer_type', { length: 20 })
    .notNull()
    .default('walk_in'), // walk_in | credit | hire_purchase
  customer_id: integer('customer_id'),
  customer_name: varchar('customer_name', { length: 255 }),

  note: text('note'),

  /* timestamps */
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * sale_items
 * - Line items for each sale
 * - Stores product_name at time of sale (survives product deletion/rename)
 * - Stores unit_cost at time of sale for accurate FIFO profit calculation
 * - For M-Pesa sales, unit_cost and profit are backfilled in the callback
 *   after FIFO deduction runs on payment confirmation
 */
export const saleItems = pgTable('sale_items', {
  id: serial('id').primaryKey(),

  sale_id: integer('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),

  product_id: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  // Product name captured at time of sale
  // Ensures statement/ledger accuracy even if product is renamed or deleted
  product_name: varchar('product_name', { length: 255 }).notNull().default(''),

  /* quantity and pricing */
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unit_price: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  total_price: decimal('total_price', { precision: 12, scale: 2 }).notNull(),

  /* cost/profit — backfilled for M-Pesa sales on callback */
  unit_cost: decimal('unit_cost', { precision: 12, scale: 4 })
    .notNull()
    .default('0'),
  profit: decimal('profit', { precision: 12, scale: 2 }).notNull().default('0'),

  created_at: timestamp('created_at').defaultNow().notNull(),
});
