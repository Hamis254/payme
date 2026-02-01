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
import { businesses } from '#models/setting.model.js';

// Expense categories: flexible categories for different business types
// Rent, Utilities, Salaries, Supplies, Transportation, Marketing,
// Maintenance, Insurance, Licenses, Other
// Allow "N/A" when expense type doesn't apply to business
export const EXPENSE_CATEGORIES = [
  'rent',
  'utilities',
  'salaries',
  'supplies',
  'transportation',
  'marketing',
  'maintenance',
  'insurance',
  'licenses',
  'other',
  'n/a',
];

// Payment methods
export const PAYMENT_METHODS = ['cash', 'mpesa', 'bank_transfer', 'cheque'];

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  // Expense categorization
  category: varchar('category', { length: 30 }).notNull(), // rent, utilities, salaries, supplies, transportation, marketing, maintenance, insurance, licenses, other, n/a
  description: varchar('description', { length: 255 }).notNull(), // e.g., "Monthly rent for shop", "Fuel for delivery", "Staff salary"

  // Amount and currency
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(), // Always in KES
  currency: varchar('currency', { length: 3 }).default('KES').notNull(),

  // Payment details
  payment_method: varchar('payment_method', { length: 20 }).notNull(), // cash | mpesa | bank_transfer | cheque
  payment_reference: varchar('payment_reference', { length: 128 }), // M-Pesa receipt, cheque number, bank ref
  payment_phone: varchar('payment_phone', { length: 20 }), // Phone for M-Pesa payments

  // Dates
  expense_date: date('expense_date').notNull(), // When expense occurred
  payment_date: date('payment_date'), // When payment was made (if different)

  // Status and notes
  status: varchar('status', { length: 20 }).default('recorded').notNull(), // recorded | verified | approved | paid | cancelled
  note: text('note'), // Additional context
  receipt_url: varchar('receipt_url', { length: 512 }), // Photo or document URL

  // Audit trail
  created_by: integer('created_by').notNull(), // User who recorded
  verified_by: integer('verified_by'), // User who verified (optional)
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow(),
});
