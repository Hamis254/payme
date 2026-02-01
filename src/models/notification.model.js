import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';
import { users } from '#models/user.model.js';

// Notifications: All user notifications (SMS, email, in-app)
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Notification metadata
  type: varchar('type', { length: 50 }).notNull(), // payment_complete, low_stock, sale_created, payment_failed, wallet_low, etc.
  channel: varchar('channel', { length: 20 }).notNull().default('in_app'), // in_app, sms, email, all
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),

  // Related data (for context/links)
  related_id: integer('related_id'), // sale_id, stock_id, etc.
  related_type: varchar('related_type', { length: 50 }), // sale, stock, payment, etc.
  metadata: jsonb('metadata'), // Additional data: {amount, phone, product_name, etc.}

  // Status tracking
  is_read: boolean('is_read').default(false).notNull(),
  sent_at: timestamp('sent_at'), // When notification was sent
  delivered_at: timestamp('delivered_at'), // When confirmed delivered (SMS/email)

  // SMS/Email delivery status
  sms_sent: boolean('sms_sent').default(false).notNull(),
  sms_error: text('sms_error'), // If SMS failed, why
  email_sent: boolean('email_sent').default(false).notNull(),
  email_error: text('email_error'), // If email failed, why

  // Audit trail
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// User notification preferences (SMS/email opt-in)
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: serial('id').primaryKey(),
    user_id: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Channel preferences
    sms_enabled: boolean('sms_enabled').default(true).notNull(),
    email_enabled: boolean('email_enabled').default(true).notNull(),
    in_app_enabled: boolean('in_app_enabled').default(true).notNull(),

    // Notification type preferences
    payment_notifications: boolean('payment_notifications').default(true).notNull(), // Payment complete, failed
    stock_notifications: boolean('stock_notifications').default(true).notNull(), // Low stock, expiring
    sales_notifications: boolean('sales_notifications').default(true).notNull(), // New sale
    wallet_notifications: boolean('wallet_notifications').default(true).notNull(), // Low balance, purchase
    credit_notifications: boolean('credit_notifications').default(true).notNull(), // Credit payments due
    expense_notifications: boolean('expense_notifications').default(true).notNull(), // Expense recorded
    daily_summary: boolean('daily_summary').default(false).notNull(), // Daily sales summary

    // SMS specifics
    sms_phone: varchar('sms_phone', { length: 20 }), // Phone for SMS (may differ from user phone)

    // Do not disturb
    quiet_hours_enabled: boolean('quiet_hours_enabled').default(false).notNull(),
    quiet_start: varchar('quiet_start', { length: 5 }), // HH:mm format, e.g. "22:00"
    quiet_end: varchar('quiet_end', { length: 5 }), // HH:mm format, e.g. "06:00"

    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull(),
  }
);

// Notification templates (for consistency)
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: serial('id').primaryKey(),
    type: varchar('type', { length: 50 }).notNull().unique(), // payment_complete, low_stock, etc.
    title: varchar('title', { length: 255 }).notNull(),
    sms_template: text('sms_template').notNull(), // {{variable}} format
    email_subject: varchar('email_subject', { length: 255 }).notNull(),
    email_template: text('email_template').notNull(), // HTML with {{variable}}
    is_active: boolean('is_active').default(true).notNull(),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull(),
  }
);
