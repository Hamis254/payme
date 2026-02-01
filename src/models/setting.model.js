import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  boolean,
  text,
} from 'drizzle-orm/pg-core';
import { users } from '#models/user.model.js';

// Businesses (business settings per user; one user can have many businesses)
// payment_method is restricted (in validation) to one of:
// - 'till_number'
// - 'paybill'
// - 'wallet' (uses fixed paybill 650880 and account 37605544)
// payment_identifier will hold the actual till/paybill that will be used
// later when triggering Safaricom STK Push to the customer.
export const businesses = pgTable('businesses', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  location: varchar('location', { length: 255 }).notNull(),
  location_description: varchar('location_description', { length: 512 }),
  payment_method: varchar('payment_method', { length: 50 }).notNull(),
  payment_identifier: varchar('payment_identifier', { length: 50 }).notNull(),
  verified: boolean('verified').notNull().default(false),

  // Google Sheets Integration
  google_sheets_spreadsheet_id: varchar('google_sheets_spreadsheet_id', { length: 255 }),
  google_sheets_enabled: boolean('google_sheets_enabled').default(false),
  google_sheets_auth_token: text('google_sheets_auth_token'), // Stores encrypted refresh token

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
