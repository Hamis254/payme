// auditLog.model.js
import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  text,
  jsonb,
  inet,
  decimal,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';
import { users } from '#models/user.model.js';

/**
 * Audit Log
 * Complete audit trail of all business operations
 */
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  
  // User who performed the action
  user_id: integer('user_id').references(() => users.id),
  
  // User email (denormalized for quick access)
  user_email: varchar('user_email', { length: 255 }),
  
  // User role at time of action
  user_role: varchar('user_role', { length: 50 }),
  
  // Action details
  action: varchar('action', { length: 100 }).notNull(), // create | update | delete | view | login | logout
  entity_type: varchar('entity_type', { length: 100 }).notNull(), // sale | expense | stock | product | user | payment
  entity_id: integer('entity_id'),
  
  // Change details
  previous_value: jsonb('previous_value'), // State before change
  new_value: jsonb('new_value'), // State after change
  changed_fields: jsonb('changed_fields'), // Array of field names that changed
  
  // Additional context
  description: text('description'), // Human-readable description
  reason: text('reason'), // Optional reason for the action
  
  // Request metadata
  ip_address: inet('ip_address'),
  user_agent: varchar('user_agent', { length: 500 }),
  request_id: varchar('request_id', { length: 100 }),
  
  // Risk level
  risk_level: varchar('risk_level', { length: 20 })
    .notNull()
    .default('low'), // low | medium | high | critical
  
  // Timestamp
  created_at: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Sensitive Action Logs
 * Tracks high-risk actions like refunds, price changes, large transactions
 */
export const sensitiveActions = pgTable('sensitive_actions', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  
  // Action details
  action_type: varchar('action_type', { length: 100 }).notNull(), // refund | price_change | discount_approve | large_transaction
  entity_type: varchar('entity_type', { length: 100 }).notNull(),
  entity_id: integer('entity_id'),
  
  // Amount/value involved (for financial actions)
  amount: decimal('amount', { precision: 12, scale: 2 }),
  
  // Approval workflow
  requires_approval: integer('requires_approval').notNull().default(0),
  approval_status: varchar('approval_status', { length: 20 }), // pending | approved | rejected
  approved_by: integer('approved_by').references(() => users.id),
  approved_at: timestamp('approved_at'),
  approval_note: text('approval_note'),
  
  // Who performed the action
  performed_by: integer('performed_by')
    .notNull()
    .references(() => users.id),
  
  // Reason for action
  reason: text('reason').notNull(),
  
  // Before/after values
  before_value: jsonb('before_value'),
  after_value: jsonb('after_value'),
  
  // Metadata
  metadata: jsonb('metadata'),
  
  created_at: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Login History
 * Track user login activity for security
 */
export const loginHistory = pgTable('login_history', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  
  // Login details
  action: varchar('action', { length: 20 }).notNull(), // login | logout | failed_login
  ip_address: inet('ip_address'),
  user_agent: varchar('user_agent', { length: 500 }),
  
  // Location (if detectable)
  city: varchar('city', { length: 100 }),
  country: varchar('country', { length: 100 }),
  
  // Status
  success: integer('success').notNull().default(1), // 1 = success, 0 = failed
  failure_reason: varchar('failure_reason', { length: 255 }),
  
  // Session info
  session_id: varchar('session_id', { length: 100 }),
  
  created_at: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Data Export Logs
 * Track when data is exported for compliance
 */
export const dataExportLogs = pgTable('data_export_logs', {
  id: serial('id').primaryKey(),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  
  // User who performed export
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id),
  
  // Export details
  export_type: varchar('export_type', { length: 50 }).notNull(), // report | backup | data_dump
  format: varchar('format', { length: 20 }).notNull(), // csv | pdf | xlsx | json
  
  // Data scope
  entity_types: jsonb('entity_types'), // Array of entity types exported
  filters_applied: jsonb('filters_applied'), // Filters used for export
  
  // Export status
  record_count: integer('record_count').notNull().default(0),
  file_size_bytes: integer('file_size_bytes'),
  
  // Download URL (if applicable)
  download_url: varchar('download_url', { length: 500 }),
  
  created_at: timestamp('created_at').defaultNow().notNull(),
});
