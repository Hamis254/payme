import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  boolean,
  text,
  decimal,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '#models/user.model.js';

// A business is either a main business or a branch of exactly one main.
// Branch status: a branch of another user's main waits in 'pending_approval'
// until the main owner's OTP is entered; everything else is 'active'.
export const BRANCH_STATUS = Object.freeze({
  ACTIVE: 'active',
  PENDING_APPROVAL: 'pending_approval',
});

// Businesses (business settings per user; one user can have many businesses)
// payment_method is restricted (in validation) to one of:
// - 'till_number'
// - 'paybill'
// - 'wallet' (uses fixed till number 3485049 and account reference Onlinebuygoods)
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
  // URL of the business logo / profile picture. Store only the URL here —
  // the actual image file lives in object storage (e.g. Firebase Storage),
  // which FlutterFlow can upload to directly without any backend code.
  logo_url: varchar('logo_url', { length: 1024 }),

  // Human-facing ID, shown in settings. Main codes look like PRO4821 and branch
  // codes like PRO4821-2. Server-generated and read-only after creation.
  business_code: varchar('business_code', { length: 32 }).notNull().unique(),
  is_main: boolean('is_main').notNull().default(true),
  // One level only: a branch points at a main, and a main has no parent. The
  // table-level check below enforces the shape; the service enforces that the
  // parent is itself a main.
  parent_business_id: integer('parent_business_id').references(
    () => businesses.id
  ),
  // 1, 2, 3... per parent. Allocated under a row lock on the parent.
  branch_sequence: integer('branch_sequence'),
  branch_status: varchar('branch_status', { length: 20 })
    .notNull()
    .default(BRANCH_STATUS.ACTIVE),

  payment_method: varchar('payment_method', { length: 50 }).notNull(),
  payment_identifier: varchar('payment_identifier', { length: 50 }).notNull(),
  verified: boolean('verified').notNull().default(false),
  credit_risk_threshold_percent: decimal('credit_risk_threshold_percent', {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default('70.00'),

  // Google Sheets Integration
  google_sheets_spreadsheet_id: varchar('google_sheets_spreadsheet_id', {
    length: 255,
  }),
  google_sheets_enabled: boolean('google_sheets_enabled').default(false),
  google_sheets_auth_token: text('google_sheets_auth_token'), // Stores encrypted refresh token

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, table => [
  // Two simultaneous branch creations under one main cannot share a sequence.
  // NULLs are distinct in Postgres, so main rows (both NULL) don't collide.
  uniqueIndex('idx_businesses_parent_branch_sequence').on(
    table.parent_business_id,
    table.branch_sequence
  ),
  check(
    'businesses_branch_shape_check',
    sql`(is_main AND parent_business_id IS NULL AND branch_sequence IS NULL)
      OR (NOT is_main AND parent_business_id IS NOT NULL AND branch_sequence IS NOT NULL)`
  ),
  check(
    'businesses_branch_status_check',
    sql`branch_status IN ('active', 'pending_approval')`
  ),
]);