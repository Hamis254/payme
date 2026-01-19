import { pgTable, serial, integer, varchar, timestamp, boolean } from 'drizzle-orm/pg-core';
import { users } from '#models/user.model.js';

// Businesses (business settings per user; one user can have many businesses)
// payment_method is restricted (in validation) to one of:
// - 'till_number'
// - 'paybill'
// - 'pochi_la_biashara'
// - 'send_money'
// payment_identifier will hold the actual till/paybill/phone that will be used
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
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
