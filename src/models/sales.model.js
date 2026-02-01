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
  payment_mode: varchar('payment_mode', { length: 20 }).notNull(), // 'cash' | 'mpesa'
  token_fee: integer('token_fee').notNull().default(1), // tokens reserved/charged for this sale

  /* MPESA / STK reconciliation fields */
  stk_request_id: varchar('stk_request_id', { length: 128 }), // CheckoutRequestID
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }), // MpesaReceiptNumber
  mpesa_sender_name: varchar('mpesa_sender_name', { length: 255 }),
  mpesa_sender_phone: varchar('mpesa_sender_phone', { length: 20 }),
  amount_paid: decimal('amount_paid', { precision: 12, scale: 2 }),
  payment_status: varchar('payment_status', { length: 20 })
    .notNull()
    .default('pending'),
  callback_payload: text('callback_payload'),

  /* sale lifecycle and customer info */
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | completed | failed | refunded
  customer_type: varchar('customer_type', { length: 20 })
    .notNull()
    .default('walk_in'), // walk_in | credit | hire_purchase
  customer_id: integer('customer_id'), // optional FK to customers table (if exists)
  customer_name: varchar('customer_name', { length: 255 }),

  note: text('note'),

  /* timestamps */
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * sale_items
 * - Line items for each sale
 * - Stores unit cost at time of sale for accurate profit calculation
 */
export const saleItems = pgTable('sale_items', {
  id: serial('id').primaryKey(),

  sale_id: integer('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),

  product_id: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  /* quantity and pricing */
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unit_price: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  total_price: decimal('total_price', { precision: 12, scale: 2 }).notNull(),

  /* cost/profit */
  unit_cost: decimal('unit_cost', { precision: 12, scale: 2 }).notNull(),
  profit: decimal('profit', { precision: 12, scale: 2 }).notNull(),

  created_at: timestamp('created_at').defaultNow().notNull(),
});
