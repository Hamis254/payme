import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  decimal,
  date,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';

/**
 * analytics_cache
 * Pre-calculated metrics stored for fast dashboard queries
 * Updated via scheduled job every hour and on-demand
 * Stores metrics for: daily, weekly, monthly, yearly periods
 */
export const analyticsCache = pgTable('analytics_cache', {
  id: serial('id').primaryKey(),

  /* business this metric belongs to */
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  /* metric identifier */
  metric_name: varchar('metric_name', { length: 100 }).notNull(), // 'total_sales', 'total_profit', 'avg_transaction', etc
  period: varchar('period', { length: 20 }).notNull(), // 'daily', 'weekly', 'monthly', 'yearly'
  period_date: date('period_date').notNull(), // date representing the period (start date)

  /* metric value */
  metric_value: decimal('metric_value', { precision: 15, scale: 2 }).notNull(),

  /* additional context */
  comparison_previous: decimal('comparison_previous', { precision: 15, scale: 2 }), // previous period value for trend
  change_percent: decimal('change_percent', { precision: 8, scale: 2 }), // percent change from previous period

  /* lifecycle */
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * product_analytics
 * Per-product performance metrics
 * Revenue, units sold, profit, trend per product
 */
export const productAnalytics = pgTable('product_analytics', {
  id: serial('id').primaryKey(),

  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  product_id: integer('product_id').notNull(),
  product_name: varchar('product_name', { length: 255 }).notNull(),

  period: varchar('period', { length: 20 }).notNull(), // 'daily', 'weekly', 'monthly'
  period_date: date('period_date').notNull(),

  /* product metrics */
  units_sold: decimal('units_sold', { precision: 12, scale: 3 }).notNull().default(0),
  total_revenue: decimal('total_revenue', { precision: 12, scale: 2 }).notNull().default(0),
  total_cost: decimal('total_cost', { precision: 12, scale: 2 }).notNull().default(0),
  total_profit: decimal('total_profit', { precision: 12, scale: 2 }).notNull().default(0),

  /* rankings */
  rank_by_revenue: integer('rank_by_revenue'), // 1 = top product
  rank_by_profit: integer('rank_by_profit'),
  rank_by_units: integer('rank_by_units'),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * customer_analytics
 * Customer purchase behavior: frequency, spend, loyalty
 */
export const customerAnalytics = pgTable('customer_analytics', {
  id: serial('id').primaryKey(),

  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  customer_name: varchar('customer_name', { length: 255 }).notNull(),
  customer_phone: varchar('customer_phone', { length: 20 }),

  /* lifetime metrics */
  total_purchases: integer('total_purchases').notNull().default(0),
  total_spent: decimal('total_spent', { precision: 12, scale: 2 }).notNull().default(0),
  avg_transaction_value: decimal('avg_transaction_value', { precision: 12, scale: 2 }).default(0),

  /* frequency */
  last_purchase_date: date('last_purchase_date'),
  first_purchase_date: date('first_purchase_date'),
  days_since_last_purchase: integer('days_since_last_purchase'),

  /* loyalty */
  is_repeat_customer: integer('is_repeat_customer').default(0), // 1 = 2+ purchases
  repeat_frequency: varchar('repeat_frequency', { length: 20 }), // 'one_time', 'occasional', 'regular', 'frequent'

  /* status */
  status: varchar('status', { length: 20 }).default('active'), // active | inactive | lost

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * revenue_breakdown
 * Revenue split by payment method and customer type
 */
export const revenueBreakdown = pgTable('revenue_breakdown', {
  id: serial('id').primaryKey(),

  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  period: varchar('period', { length: 20 }).notNull(), // 'daily', 'weekly', 'monthly'
  period_date: date('period_date').notNull(),

  /* breakdown dimensions */
  payment_method: varchar('payment_method', { length: 50 }), // cash | mpesa
  customer_type: varchar('customer_type', { length: 50 }), // walk_in | credit | hire_purchase

  /* revenue metrics */
  total_revenue: decimal('total_revenue', { precision: 12, scale: 2 }).notNull().default(0),
  transaction_count: integer('transaction_count').notNull().default(0),
  avg_transaction: decimal('avg_transaction', { precision: 12, scale: 2 }).default(0),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
