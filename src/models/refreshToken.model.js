/**
 * =============================================================================
 * MODEL: REFRESH TOKENS
 * =============================================================================
 *
 * Stores one row per active refresh token per device/session.
 * A user can have multiple rows (multiple devices logged in simultaneously).
 *
 * SECURITY DESIGN
 * ────────────────
 * • The actual token sent to the client is a 64-byte random hex string.
 * • Only the SHA-256 hash of that string is stored here — if the DB is
 *   breached the tokens cannot be used without the originals.
 * • Each token is single-use: rotation immediately replaces the row with
 *   a new token, invalidating the old one.
 * • Reuse detection: if a token that has already been rotated is presented,
 *   the family_id links it to the current active session, allowing the server
 *   to revoke all tokens in that family (signs the user out of that device).
 *
 * LIFECYCLE
 * ──────────
 * 1. Sign-in / sign-up → new row inserted (status = 'active')
 * 2. POST /api/auth/refresh → row replaced atomically:
 *      old row status → 'rotated'
 *      new row inserted (same family_id, new token_hash)
 * 3. Reuse detected (old 'rotated' token presented) →
 *      all rows sharing family_id → status = 'revoked'
 * 4. Sign-out → current row deleted (or status = 'revoked')
 * 5. Sign-out-all → all rows for user_id deleted
 * 6. Cron cleanup → expired / revoked rows deleted
 *
 * @module models/refreshToken
 * =============================================================================
 */

import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from '#models/user.model.js';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: serial('id').primaryKey(),

    // Owner
    user_id: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // SHA-256 hash of the raw token sent to the client.
    // UNIQUE: two concurrent logins cannot share a hash (astronomically
    // unlikely with 64-byte random tokens, but enforced for safety).
    token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),

    // Groups all rotated versions of the same session together.
    // On first login = same value as token_hash of the first token.
    // Preserved through every rotation so we can revoke the whole chain
    // if reuse is detected.
    family_id: varchar('family_id', { length: 64 }).notNull(),

    // 'active'  — valid, may be used to refresh once
    // 'rotated' — already exchanged; presenting this again = theft signal
    // 'revoked' — explicitly invalidated (sign-out, reuse detection)
    status: varchar('status', { length: 10 }).notNull().default('active'),

    // Optional: which device/client issued this token (for display in
    // "active sessions" UI — e.g. "Chrome on Android").
    device_hint: varchar('device_hint', { length: 255 }),

    // When this token stops being accepted even if status = 'active'.
    expires_at: timestamp('expires_at').notNull(),

    created_at: timestamp('created_at').defaultNow().notNull(),
  },
  table => [
    // Primary lookup on every /refresh call
    index('idx_refresh_token_hash').on(table.token_hash),

    // Used during reuse detection to find and revoke the whole family
    index('idx_refresh_token_family').on(table.family_id),

    // Used during cleanup to delete expired / revoked rows
    index('idx_refresh_token_user_id').on(table.user_id),
  ]
);