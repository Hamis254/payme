import { pgTable, serial, integer, text, timestamp, boolean, jsonb, varchar } from 'drizzle-orm/pg-core';
import { users } from './user.model.js';
import { businesses } from './setting.model.js';

/**
 * Offline Queue Model
 * Stores operations that were executed offline
 * Syncs to server when connection returns
 */
export const offlineQueue = pgTable('offline_queue', {
  id: serial('id').primaryKey(),
  
  // User & Business
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id),
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id),
  
  // Operation Details
  operation_type: varchar('operation_type', { length: 50 }).notNull(), // 'sale', 'expense', 'record', 'payment', 'stock_adjustment'
  operation_id: varchar('operation_id', { length: 50 }).notNull(), // Local ID: sale_local_123
  endpoint: varchar('endpoint', { length: 255 }).notNull(), // '/api/sales/create'
  method: varchar('method', { length: 10 }).notNull(), // 'POST', 'PUT', 'PATCH'
  
  // Request Data
  request_body: jsonb('request_body').notNull(), // Full request payload
  request_headers: jsonb('request_headers'), // Headers (auth tokens, etc)
  
  // Sync Status
  status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending', 'syncing', 'synced', 'conflict', 'failed'
  sync_attempts: integer('sync_attempts').default(0).notNull(),
  max_retries: integer('max_retries').default(3).notNull(),
  
  // Response Data
  server_response: jsonb('server_response'), // Response from server after sync
  server_id: varchar('server_id', { length: 50 }), // Server-generated ID after sync
  
  // Conflict Resolution
  conflict_type: varchar('conflict_type', { length: 50 }), // 'duplicate', 'modified', 'deleted', 'version_mismatch'
  conflict_data: jsonb('conflict_data'), // Server version that conflicted
  resolution_strategy: varchar('resolution_strategy', { length: 20 }), // 'client_wins', 'server_wins', 'merge', 'manual'
  resolved_at: timestamp('resolved_at'),
  
  // Timestamps
  created_at: timestamp('created_at').defaultNow().notNull(),
  executed_at: timestamp('executed_at').notNull(), // When operation was executed offline
  synced_at: timestamp('synced_at'), // When successfully synced
  failed_at: timestamp('failed_at'), // Last failure
  
  // Error Tracking
  last_error: text('last_error'), // Error message from last attempt
  error_code: varchar('error_code', { length: 20 }), // Error code: NETWORK, CONFLICT, INVALID_DATA, etc
  
  // Device Info
  device_id: varchar('device_id', { length: 100 }), // For tracking which device synced
  sync_batch_id: varchar('sync_batch_id', { length: 100 }), // Group syncs together
});

/**
 * Offline Sync History Model
 * Tracks all sync attempts for audit and debugging
 */
export const offlineSyncHistory = pgTable('offline_sync_history', {
  id: serial('id').primaryKey(),
  
  queue_id: integer('queue_id')
    .notNull()
    .references(() => offlineQueue.id),
  
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id),
  
  // Sync Details
  sync_type: varchar('sync_type', { length: 20 }).notNull(), // 'manual', 'automatic', 'scheduled'
  status: varchar('status', { length: 20 }).notNull(), // 'success', 'failed', 'partial'
  
  // Response
  server_status: integer('server_status'), // HTTP status code (200, 409, etc)
  response_data: jsonb('response_data'), // Full response
  
  // Timing
  sync_duration_ms: integer('sync_duration_ms'), // How long sync took
  started_at: timestamp('started_at').defaultNow().notNull(),
  completed_at: timestamp('completed_at'),
  
  // Error
  error_message: text('error_message'),
  
  // Device Info
  device_id: varchar('device_id', { length: 100 }),
  network_type: varchar('network_type', { length: 20 }), // 'wifi', '4g', '3g', 'cellular'
});

/**
 * Local Offline Data Model
 * Stores temporary local data for offline operations
 * Gets cleared after successful sync
 */
export const offlineLocalData = pgTable('offline_local_data', {
  id: serial('id').primaryKey(),
  
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id),
  
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id),
  
  // Data Type
  data_type: varchar('data_type', { length: 50 }).notNull(), // 'sale', 'product', 'customer', etc
  local_id: varchar('local_id', { length: 100 }).notNull(), // Local temporary ID
  server_id: varchar('server_id', { length: 50 }), // Server ID after sync
  
  // Data
  data: jsonb('data').notNull(),
  
  // Status
  synced: boolean('synced').default(false).notNull(),
  synced_at: timestamp('synced_at'),
  
  // Timestamps
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Offline Configuration Model
 * Per-business offline settings
 */
export const offlineConfig = pgTable('offline_config', {
  id: serial('id').primaryKey(),
  
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id)
    .unique(),
  
  // Feature Flags
  offline_mode_enabled: boolean('offline_mode_enabled').default(true).notNull(),
  auto_sync_enabled: boolean('auto_sync_enabled').default(true).notNull(),
  
  // Sync Settings
  sync_interval_minutes: integer('sync_interval_minutes').default(5).notNull(), // Auto-sync every 5 mins
  max_queue_size: integer('max_queue_size').default(500).notNull(), // Max operations in queue
  retry_delay_seconds: integer('retry_delay_seconds').default(30).notNull(),
  
  // Conflict Resolution
  default_conflict_strategy: varchar('default_conflict_strategy', { length: 20 }).default('client_wins'), // 'client_wins', 'server_wins', 'merge'
  
  // Allowed Operations Offline
  allow_sales_offline: boolean('allow_sales_offline').default(true).notNull(),
  allow_expenses_offline: boolean('allow_expenses_offline').default(true).notNull(),
  allow_stock_adjustment_offline: boolean('allow_stock_adjustment_offline').default(false).notNull(),
  
  // Timestamps
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
