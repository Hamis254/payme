// user.model.js
import { pgTable, serial, timestamp, varchar, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  phone_number: varchar('phone_number', { length: 20 }),
  email: varchar('email', { length: 255 }),

  // National ID number — stored ENCRYPTED (ciphertext), never in plaintext.
  // id_number_hash is a deterministic HMAC used only for uniqueness checks
  // ("has this ID already registered an account?") — see
  // #utils/encryption.js hashForLookup(). The encrypted column can't be
  // used for that directly since encryption uses a random IV each time.
  id_number: varchar('id_number', { length: 512 }),
  id_number_hash: varchar('id_number_hash', { length: 64 }).unique(),

  // Password is a short 4-digit PIN in this app, still bcrypt-hashed below.
  password: varchar('password', { length: 255 }).notNull(),

  // Login lockout — protects the short PIN against brute-force guessing.
  // Incremented on each failed sign-in, reset to 0 on success.
  // When failed_login_attempts hits the app's MAX_FAILED_ATTEMPTS,
  // locked_until is set to "now + lock duration"; sign-in is refused
  // until that time passes, even with the correct PIN.
  failed_login_attempts: integer('failed_login_attempts').notNull().default(0),
  locked_until: timestamp('locked_until'),

  role: varchar('role', { length: 50 }).notNull().default('user'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});