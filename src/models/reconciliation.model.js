// reconciliation.model.js
import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
  jsonb,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';
import { users } from '#models/user.model.js';

/**
 * Cash Reconciliation Records
 * Tracks daily cash counts vs system records for variance detection
 */
export const cashReconciliations = pgTable('cash_reconciliations', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  
  // Reconciliation date
  reconciliation_date: timestamp('reconciliation_date').notNull(),
  
  // Cash counted by user
  counted_cash: decimal('counted_cash', { precision: 12, scale: 2 }).notNull(),
  
  // System recorded cash (from sales and other income)
  system_cash: decimal('system_cash', { precision: 12, scale: 2 }).notNull(),
  
  // Variance calculation
  variance: decimal('variance', { precision: 12, scale: 2 }).notNull(), // counted - system
  variance_percent: decimal('variance_percent', { precision: 5, scale: 2 }),
  
  // Variance status based on threshold
  variance_status: varchar('variance_status', { length: 20 })
    .notNull()
    .default('pending'), // pending | approved | flagged | investigated
  
  // Notes on variance
  variance_note: text('variance_note'),
  
  // Who performed the reconciliation
  performed_by: integer('performed_by')
    .notNull()
    .references(() => users.id),
  
  // Who approved (if variance exceeded threshold)
  approved_by: integer('approved_by').references(() => users.id),
  approved_at: timestamp('approved_at'),
  
  // Additional data (breakdown of cash denominations, etc.)
  metadata: jsonb('metadata'), // { denominations: {...}, notes: [...] }
  
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * M-Pesa Reconciliation Records
 * Tracks M-Pesa payments against bank statements
 */
export const mpesaReconciliations = pgTable('mpesa_reconciliations', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  
  // Reconciliation period
  period_start: timestamp('period_start').notNull(),
  period_end: timestamp('period_end').notNull(),
  
  // System recorded M-Pesa payments
  system_transactions: integer('system_transactions').notNull().default(0),
  system_amount: decimal('system_amount', { precision: 12, scale: 2 }).notNull(),
  
  // Bank statement M-Pesa payments (user input)
  bank_transactions: integer('bank_transactions').notNull().default(0),
  bank_amount: decimal('bank_amount', { precision: 12, scale: 2 }).notNull(),
  
  // Variance
  variance_transactions: integer('variance_transactions').notNull().default(0),
  variance_amount: decimal('variance_amount', { precision: 12, scale: 2 }).notNull(),
  
  // Status
  status: varchar('status', { length: 20 })
    .notNull()
    .default('pending'), // pending | matched | investigation_needed
  
  // Investigation notes
  investigation_notes: text('investigation_notes'),
  
  // Missing transactions (from bank but not in system)
  missing_transactions: jsonb('missing_transactions'),
  
  // Extra transactions (in system but not in bank)
  extra_transactions: jsonb('extra_transactions'),
  
  performed_by: integer('performed_by')
    .notNull()
    .references(() => users.id),
  
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Reconciliation Templates
 * Configurable thresholds and rules per business
 */
export const reconciliationConfig = pgTable('reconciliation_config', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .unique()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  
  // Cash variance threshold (percentage)
  cash_variance_threshold: decimal('cash_variance_threshold', { precision: 5, scale: 2 })
    .notNull()
    .default('2.00'), // 2% variance allowed
  
  // M-Pesa variance threshold (percentage)
  mpesa_variance_threshold: decimal('mpesa_variance_threshold', { precision: 5, scale: 2 })
    .notNull()
    .default('0.50'), // 0.5% variance allowed for M-Pesa
  
  // Daily reconciliation required
  daily_reconciliation_required: integer('daily_reconciliation_required')
    .notNull()
    .default(1),
  
  // Auto-flag high variance
  auto_flag_enabled: integer('auto_flag_enabled').notNull().default(1),
  
  // Require supervisor approval for variance above threshold
  supervisor_approval_required: integer('supervisor_approval_required').notNull().default(1),
  
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
