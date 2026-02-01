/**
 * Payment Configuration Model
 * Stores per-business M-Pesa credentials for STK Push
 * 
 * Allows each business to configure their own paybill or till number
 * for customer payments via M-Pesa Daraja API
 * 
 * Daraja API (M-Pesa Express STK Push) requires:
 * - BusinessShortCode: till number or paybill (PartyB)
 * - Passkey: B2C passkey from Daraja portal
 * - AccountReference: identifier for till/paybill (max 12 chars)
 */

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';

export const paymentConfigs = pgTable('payment_configs', {
  id: serial('id').primaryKey(),
  
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  // Payment method: 'till_number' or 'paybill'
  payment_method: varchar('payment_method', { length: 20 }).notNull(),

  // M-Pesa Daraja credentials
  // For paybill: BusinessShortCode (PartyB)
  // For till: Till number
  shortcode: varchar('shortcode', { length: 20 }).notNull(),

  // Passkey from Daraja portal (encrypted at rest)
  passkey: text('passkey').notNull(),

  // Account reference / Store number
  // For paybill: shown to customer as AccountReference (max 12 chars)
  // For till: Store number (identifier for the till)
  account_reference: varchar('account_reference', { length: 50 }).notNull(),

  // Account name (optional, for display purposes)
  account_name: varchar('account_name', { length: 255 }),

  // Whether this config is verified with Safaricom
  verified: boolean('verified').notNull().default(false),

  // Active flag (business can toggle without deleting)
  is_active: boolean('is_active').notNull().default(true),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
