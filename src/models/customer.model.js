import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  text,
  date,
  boolean,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';

/**
 * customers
 * Core customer contact information
 * Tracks: name, phone, email, address, customer type
 */
export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),

  /* business ownership */
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  /* customer info */
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),

  /* classification */
  customer_type: varchar('customer_type', { length: 50 }).default('walk_in'), // walk_in | regular | vip | wholesale
  is_active: boolean('is_active').default(true),

  /* contact preferences */
  prefer_sms: boolean('prefer_sms').default(true),
  prefer_email: boolean('prefer_email').default(false),
  prefer_call: boolean('prefer_call').default(false),

  /* timestamps */
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * customer_notes
 * Internal notes and interactions log
 * Track: personal info, preferences, special requests
 */
export const customerNotes = pgTable('customer_notes', {
  id: serial('id').primaryKey(),

  customer_id: integer('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),

  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  /* note content and type */
  note_type: varchar('note_type', { length: 50 }), // 'personal', 'preference', 'issue', 'feedback'
  content: text('content').notNull(),

  /* tracking */
  created_by: integer('created_by'), // user_id who created the note
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * customer_preferences
 * Purchase preferences and buying patterns
 * Track: favorite products, preferred payment, best time to contact
 */
export const customerPreferences = pgTable('customer_preferences', {
  id: serial('id').primaryKey(),

  customer_id: integer('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),

  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  /* purchase preferences */
  favorite_products: text('favorite_products'), // JSON array of product IDs
  preferred_payment: varchar('preferred_payment', { length: 50 }), // cash | mpesa | credit
  average_spend: decimal('average_spend', { precision: 12, scale: 2 }).default(0),

  /* contact preferences */
  best_contact_time: varchar('best_contact_time', { length: 100 }), // "mornings", "evenings", "weekends"
  do_not_contact: boolean('do_not_contact').default(false),

  /* engagement */
  can_receive_offers: boolean('can_receive_offers').default(true),
  can_receive_loyalty: boolean('can_receive_loyalty').default(true),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * customer_purchase_history
 * Denormalized view of customer purchases for fast analytics
 * Updated on each sale completion
 */
export const customerPurchaseHistory = pgTable('customer_purchase_history', {
  id: serial('id').primaryKey(),

  customer_id: integer('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),

  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  /* metrics */
  total_purchases: integer('total_purchases').notNull().default(0),
  total_spent: decimal('total_spent', { precision: 12, scale: 2 }).notNull().default(0),
  total_items_bought: decimal('total_items_bought', { precision: 12, scale: 3 }).default(0),
  avg_transaction_value: decimal('avg_transaction_value', { precision: 12, scale: 2 }).default(0),

  /* dates */
  first_purchase_date: date('first_purchase_date'),
  last_purchase_date: date('last_purchase_date'),
  days_since_last_purchase: integer('days_since_last_purchase'),

  /* customer status */
  is_repeat_customer: boolean('is_repeat_customer').default(false), // 2+ purchases
  customer_lifetime_value: decimal('customer_lifetime_value', { precision: 12, scale: 2 }).default(0),
  repeat_frequency: varchar('repeat_frequency', { length: 50 }), // one_time | occasional | regular | frequent

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
