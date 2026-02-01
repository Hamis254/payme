import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
  date,
} from 'drizzle-orm/pg-core';
import { sales } from '#models/sales.model.js';
import { creditAccounts } from '#models/credit.model.js';
import { businesses } from '#models/setting.model.js';

// Hire Purchase Agreement (extends credit sales)
// Customer pays in installments over time with interest
export const hirePurchaseAgreements = pgTable('hire_purchase_agreements', {
  id: serial('id').primaryKey(),
  sale_id: integer('sale_id')
    .notNull()
    .references(() => sales.id, { onDelete: 'cascade' }),
  account_id: integer('account_id')
    .notNull()
    .references(() => creditAccounts.id, { onDelete: 'cascade' }),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  // Financial terms
  principal_amount: decimal('principal_amount', {
    precision: 12,
    scale: 2,
  }).notNull(),
  interest_rate: decimal('interest_rate', { precision: 5, scale: 2 })
    .notNull()
    .default('0'), // annual percentage
  total_amount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(), // principal + interest
  down_payment: decimal('down_payment', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  amount_financed: decimal('amount_financed', {
    precision: 12,
    scale: 2,
  }).notNull(), // total - down_payment

  // Installment details
  installment_amount: decimal('installment_amount', {
    precision: 12,
    scale: 2,
  }).notNull(),
  installment_frequency: varchar('installment_frequency', {
    length: 20,
  }).notNull(), // daily | weekly | bi-weekly | monthly
  number_of_installments: integer('number_of_installments').notNull(),
  installments_paid: integer('installments_paid').notNull().default(0),

  // Dates
  agreement_date: date('agreement_date').notNull(),
  first_payment_date: date('first_payment_date').notNull(),
  final_payment_date: date('final_payment_date').notNull(),

  // Status tracking
  status: varchar('status', { length: 20 }).notNull().default('active'), // active | completed | defaulted | cancelled
  balance_remaining: decimal('balance_remaining', {
    precision: 12,
    scale: 2,
  }).notNull(),

  // Additional terms
  late_fee_amount: decimal('late_fee_amount', {
    precision: 12,
    scale: 2,
  }).default('0'),
  grace_period_days: integer('grace_period_days').default(0),
  terms_and_conditions: text('terms_and_conditions'),
  notes: text('notes'),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
  created_by: integer('created_by'),
});

// Individual installment payments
export const hirePurchaseInstallments = pgTable('hire_purchase_installments', {
  id: serial('id').primaryKey(),
  agreement_id: integer('agreement_id')
    .notNull()
    .references(() => hirePurchaseAgreements.id, { onDelete: 'cascade' }),

  // Installment details
  installment_number: integer('installment_number').notNull(),
  due_date: date('due_date').notNull(),
  amount_due: decimal('amount_due', { precision: 12, scale: 2 }).notNull(),

  // Payment tracking
  amount_paid: decimal('amount_paid', { precision: 12, scale: 2 }).default('0'),
  payment_date: date('payment_date'),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | paid | overdue | partial

  // Payment method
  payment_method: varchar('payment_method', { length: 20 }), // cash | mpesa
  mpesa_transaction_id: varchar('mpesa_transaction_id', { length: 128 }),

  // Late fees
  late_fee_charged: decimal('late_fee_charged', {
    precision: 12,
    scale: 2,
  }).default('0'),
  days_overdue: integer('days_overdue').default(0),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow(),
});
