// models/credit.model.js
import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
  boolean,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';

// One row per customer credit account (per business)
export const creditAccounts = pgTable('credit_accounts', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  customer_id: integer('customer_id').notNull(), // your existing customer id or external ref
  customer_name: varchar('customer_name', { length: 255 }).notNull(),
  credit_limit: decimal('credit_limit', { precision: 12, scale: 2 })
    .notNull()
    .default(0),
  balance_due: decimal('balance_due', { precision: 12, scale: 2 })
    .notNull()
    .default(0),
  last_payment_at: timestamp('last_payment_at'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// Each credit sale links to sales.sale id (sale already has customer_type = 'credit' and customer_id)
export const creditSales = pgTable('credit_sales', {
  id: serial('id').primaryKey(),
  sale_id: integer('sale_id').notNull(), // references sales.id (optional FK if you want)
  account_id: integer('account_id')
    .notNull()
    .references(() => creditAccounts.id, { onDelete: 'cascade' }),
  due_date: timestamp('due_date').notNull(),
  outstanding_amount: decimal('outstanding_amount', {
    precision: 12,
    scale: 2,
  }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('open'), // open | paid | overdue | written_off
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// Payments made against credit accounts (cash or mpesa)
export const creditPayments = pgTable('credit_payments', {
  id: serial('id').primaryKey(),
  account_id: integer('account_id')
    .notNull()
    .references(() => creditAccounts.id, { onDelete: 'cascade' }),
  sale_id: integer('sale_id'), // optional link to sale
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  payment_method: varchar('payment_method', { length: 20 }).notNull(), // cash | mpesa | b2c
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }),
  stk_request_id: varchar('stk_request_id', { length: 128 }),
  reference: varchar('reference', { length: 255 }), // free text
  created_at: timestamp('created_at').defaultNow().notNull(),
  created_by: integer('created_by'), // optional user id
  callback_payload: text('callback_payload'),
});

// Ledger entries for audit and interest/fees
export const creditLedger = pgTable('credit_ledger', {
  id: serial('id').primaryKey(),
  account_id: integer('account_id')
    .notNull()
    .references(() => creditAccounts.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(), // sale | payment | interest | fee | write_off
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  balance_after: decimal('balance_after', {
    precision: 12,
    scale: 2,
  }).notNull(),
  reference: varchar('reference', { length: 255 }),
  note: text('note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  created_by: integer('created_by'),
});
