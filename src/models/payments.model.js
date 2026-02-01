import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
} from 'drizzle-orm/pg-core';
import { sales } from '#models/sales.model.js';

// Track all payment attempts and M-Pesa STK Push transactions
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  sale_id: integer('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),

  // M-Pesa STK Push fields
  stk_request_id: varchar('stk_request_id', { length: 128 }), // CheckoutRequestID from Daraja
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }), // MpesaReceiptNumber
  phone: varchar('phone', { length: 20 }),

  // Payment details
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | initiated | success | failed | reversed

  // Callback data
  callback_payload: text('callback_payload'),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow(),
});
