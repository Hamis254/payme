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
import { sales } from '#models/sales.model.js';

// Token pricing packages
// 1 token = KSH 2 (retail)
// Packages with discounts:
// 30 tokens = KSH 50 (saves KSH 10)
// 70 tokens = KSH 100 (saves KSH 40)
// 150 tokens = KSH 200 (saves KSH 100)
// 400 tokens = KSH 500 (saves KSH 300)
// 850 tokens = KSH 1000 (saves KSH 700)

// Each business has one wallet to track token balance
export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .unique()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  balance_tokens: integer('balance_tokens').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// All wallet token changes (purchases, charges, refunds, reserves)
export const walletTransactions = pgTable('wallet_transactions', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  change_tokens: integer('change_tokens').notNull(), // positive for topup, negative for charge
  type: varchar('type', { length: 50 }).notNull(), // purchase | reserve | charge | refund
  reference: varchar('reference', { length: 255 }), // sale_id, payment_id, etc
  note: text('note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  created_by: integer('created_by'), // user_id who initiated
});

// Token purchase history (top-ups via M-Pesa)
export const tokenPurchases = pgTable('token_purchases', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  package_type: varchar('package_type', { length: 50 }).notNull(), // '30', '70', '150', '400', '850'
  tokens_purchased: integer('tokens_purchased').notNull(),
  amount_paid: decimal('amount_paid', { precision: 12, scale: 2 }).notNull(),
  payment_method: varchar('payment_method', { length: 20 }).notNull(), // mpesa | cash

  // M-Pesa fields
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }),
  mpesa_phone: varchar('mpesa_phone', { length: 20 }),
  stk_request_id: varchar('stk_request_id', { length: 128 }),

  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | success | failed
  callback_payload: text('callback_payload'),

  created_at: timestamp('created_at').defaultNow().notNull(),
  completed_at: timestamp('completed_at'),
});

// Wallet payments via paybill 650880
// Used for payment processing when business is configured for wallet payments
export const walletPayments = pgTable('wallet_payments', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  sale_id: integer('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),
  amount_ksh: integer('amount_ksh').notNull(), // Amount in KSH
  phone: varchar('phone', { length: 20 }).notNull(), // Customer phone
  payment_status: varchar('payment_status', { length: 20 })
    .notNull()
    .default('pending'), // pending | completed | failed
  paybill: varchar('paybill', { length: 10 }).notNull(), // Fixed: 650880
  account_reference: varchar('account_reference', { length: 50 }).notNull(), // Fixed: 37605544
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }), // Set when payment completes
  callback_payload: text('callback_payload'), // M-Pesa callback data
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

