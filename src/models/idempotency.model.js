// idempotencyKey.model.js
import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from '#models/user.model.js';

/**
 * Idempotency Keys
 *
 * Stores the request/response pair for every mutation that arrives with an
 * `Idempotency-Key` header (UUID v4).  On a duplicate key the middleware
 * short-circuits and replays the cached response — the business logic never
 * runs a second time.
 *
 * Lifecycle:
 *   1. Request arrives  → row inserted (status = 'processing')
 *   2. Handler finishes → row updated  (status = 'completed', response saved)
 *   3. Duplicate arrives → row found   → cached response returned immediately
 *   4. Cron / cleanup   → rows where expires_at < NOW() are deleted
 *
 * Concurrency safety:
 *   The UNIQUE constraint on idempotency_key means two simultaneous identical
 *   requests will produce a DB-level conflict on insert.  The middleware
 *   catches that and returns 409 Conflict so the client knows a first request
 *   is already in-flight, rather than silently processing twice.
 *
 * Index strategy:
 *   - uniqueIndex on idempotency_key  → O(1) lookup on every request
 *   - index on expires_at             → fast range-scan during nightly cleanup
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: serial('id').primaryKey(),

    // The UUID v4 sent by the client in the `Idempotency-Key` header.
    // UNIQUE enforced at DB level — last line of defence against race conditions.
    idempotency_key: varchar('idempotency_key', { length: 255 }).notNull(),

    // Which endpoint processed this request.
    // Stored for debugging / monitoring — not used for dedup logic.
    endpoint: varchar('endpoint', { length: 255 }).notNull(),

    // The user who sent the request (nullable: some endpoints are public).
    user_id: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Snapshot of the original request body.
    // Stored so a future audit can confirm the replayed request matched.
    request_body: jsonb('request_body'),

    // ── Captured response ──────────────────────────────────────────────────
    // Populated after the handler completes.  Null while status = 'processing'.
    response_status: integer('response_status'),
    response_body: jsonb('response_body'),

    // ── Status ────────────────────────────────────────────────────────────
    // 'processing' → first request is still running (prevents race conditions)
    // 'completed'  → response captured, ready to replay
    status: varchar('status', { length: 20 }).notNull().default('processing'),

    // How many times this key has been replayed (starts at 0, increments on hit)
    accessed_count: integer('accessed_count').notNull().default(0),

    // ── Timestamps ────────────────────────────────────────────────────────
    created_at: timestamp('created_at').defaultNow().notNull(),

    // When the cached response expires.  Default: 24 hours from creation.
    // After this time the cleanup job removes the row.
    expires_at: timestamp('expires_at').notNull(),
  },
  table => [
    // Primary lookup — hit on every inbound idempotent request.
    uniqueIndex('idx_idempotency_key_unique').on(table.idempotency_key),

    // Range scan used by the cleanup cron to delete expired rows efficiently.
    index('idx_idempotency_expires_at').on(table.expires_at),
  ]
);
