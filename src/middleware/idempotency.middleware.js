/**
 * =============================================================================
 * MIDDLEWARE: IDEMPOTENCY
 * =============================================================================
 *
 * Prevents duplicate processing of the same mutation request — the core
 * financial-safety guarantee for a payments product.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Client generates a UUID v4 and sends it in every mutation request:
 *      Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
 *
 * 2. Middleware checks the DB for that key:
 *      MISS  → proceed normally; intercept res.json() to capture the response.
 *      HIT   → return the cached response immediately (no business logic runs).
 *
 * 3. After the handler finishes the row is updated from 'processing' →
 *    'completed' and the response body + status are persisted.
 *
 * CONCURRENCY / RACE-CONDITION SAFETY
 * ─────────────────────────────────────
 * The `idempotency_key` column has a DB-level UNIQUE constraint.
 * If two identical requests arrive simultaneously both try to INSERT:
 *   • Winner  → proceeds normally.
 *   • Loser   → catches the unique-violation and returns 409 Conflict,
 *               signalling the client that the first request is still running.
 * This eliminates the TOCTOU gap that exists in pure SELECT-before-INSERT
 * approaches.
 *
 * USE CASES
 * ──────────
 * • User taps "Pay" twice on a slow connection        → one charge
 * • Mobile app retries after a timeout                → one charge, same response
 * • Browser auto-refreshes on a loading state         → one stock deduction
 * • Safaricom retries an M-Pesa callback              → one token credit
 *
 * APPLYING THE MIDDLEWARE
 * ────────────────────────
 *   // Only on mutation endpoints — GET/HEAD/OPTIONS pass straight through.
 *   router.post('/api/payme/', idempotencyMiddleware(), requirePaymentConfig, processPayMe);
 *
 * CLIENT INTEGRATION
 * ───────────────────
 *   const key = crypto.randomUUID();              // generate once per operation
 *   fetch('/api/payme/', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type':   'application/json',
 *       'Idempotency-Key': key,
 *     },
 *     body: JSON.stringify(payload),
 *   });
 *
 * RESPONSE HEADERS
 * ─────────────────
 *   Idempotency-Replay: true   → present only on replayed (cached) responses
 *
 * @module middleware/idempotency
 * =============================================================================
 */

import { db } from '#config/database.js';
import { idempotencyKeys } from '#models/idempotencyKey.model.js';
import { eq, and, gt, lt } from 'drizzle-orm';
import logger from '#config/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** How long a completed response is cached.  Stripe uses 24 h; we match that. */
const DEFAULT_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/** UUID v4 canonical form — the only format accepted as an Idempotency-Key. */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a string is a UUID v4.
 *
 * @param {string} key
 * @returns {boolean}
 *
 * @example
 * isValidIdempotencyKey('550e8400-e29b-41d4-a716-446655440000') // true
 * isValidIdempotencyKey('not-a-uuid')                           // false
 */
export const isValidIdempotencyKey = key => {
  if (typeof key !== 'string') return false;
  return UUID_V4_REGEX.test(key);
};

// ─────────────────────────────────────────────────────────────────────────────
// DB OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts a new idempotency record in 'processing' state.
 *
 * Returns null if the key already exists (unique-constraint violation), which
 * means a concurrent request is already in-flight for this key.
 *
 * @param {string} idempotencyKey
 * @param {string} endpoint         - e.g. '/api/payme/'
 * @param {number|null} userId      - req.user?.id
 * @param {Object} requestBody      - snapshot of req.body for auditing
 * @param {number} cacheDurationMs  - default 24 h
 * @returns {Promise<Object|null>}  - the inserted row, or null on collision
 *
 * @internal
 */
export const insertIdempotencyKey = async (
  idempotencyKey,
  endpoint,
  userId,
  requestBody,
  cacheDurationMs = DEFAULT_CACHE_DURATION_MS
) => {
  const expiresAt = new Date(Date.now() + cacheDurationMs);

  try {
    const [row] = await db
      .insert(idempotencyKeys)
      .values({
        idempotency_key: idempotencyKey,
        endpoint,
        user_id: userId ?? null,
        request_body: requestBody ?? null,
        status: 'processing',
        accessed_count: 0,
        created_at: new Date(),
        expires_at: expiresAt,
      })
      .returning();

    logger.debug('Idempotency key created', {
      idempotencyKey,
      endpoint,
      userId,
      expiresAt: expiresAt.toISOString(),
    });

    return row;
  } catch (error) {
    // Postgres unique-violation code is '23505'.
    // Drizzle surfaces this through error.code on the underlying pg driver.
    if (error.code === '23505') {
      logger.warn('Idempotency key collision — concurrent duplicate request', {
        idempotencyKey,
        endpoint,
        userId,
      });
      return null; // caller handles this as 409
    }

    // Unexpected DB error — re-throw so the middleware can decide whether to
    // fail open (let the request through) or fail closed (block it).
    throw error;
  }
};

/**
 * Persists the captured response on a 'processing' row, marking it 'completed'.
 * Called after res.json() fires inside the middleware intercept.
 *
 * @param {string} idempotencyKey
 * @param {number} responseStatus   - HTTP status code
 * @param {Object} responseBody     - serialisable response payload
 * @returns {Promise<void>}
 *
 * @internal
 */
export const completeIdempotencyKey = async (
  idempotencyKey,
  responseStatus,
  responseBody
) => {
  try {
    await db
      .update(idempotencyKeys)
      .set({
        status: 'completed',
        response_status: responseStatus,
        response_body: responseBody,
      })
      .where(eq(idempotencyKeys.idempotency_key, idempotencyKey));

    logger.debug('Idempotency key completed', {
      idempotencyKey,
      responseStatus,
    });
  } catch (error) {
    // Non-fatal — the request already succeeded; we just lose the replay cache.
    logger.error('Failed to complete idempotency key', {
      idempotencyKey,
      error: error.message,
    });
  }
};

/**
 * Looks up a key by its UUID.
 *
 * Only returns rows that are 'completed' and not yet expired.
 * Returns null for 'processing' rows so that a genuine second request after a
 * timeout still gets a 409 (handled at the insert stage) rather than replaying
 * a null/incomplete response.
 *
 * Also increments accessed_count on every cache hit for monitoring.
 *
 * @param {string} idempotencyKey
 * @returns {Promise<Object|null>}  - the matching row, or null
 *
 * @internal
 */
export const getIdempotencyKey = async idempotencyKey => {
  try {
    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.idempotency_key, idempotencyKey),
          eq(idempotencyKeys.status, 'completed'),
          gt(idempotencyKeys.expires_at, new Date()) // not expired
        )
      )
      .limit(1);

    if (!row) return null;

    // Increment the replay counter asynchronously — don't block the response.
    db.update(idempotencyKeys)
      .set({ accessed_count: row.accessed_count + 1 })
      .where(eq(idempotencyKeys.idempotency_key, idempotencyKey))
      .catch(err =>
        logger.error('Failed to increment idempotency accessed_count', {
          idempotencyKey,
          error: err.message,
        })
      );

    return row;
  } catch (error) {
    logger.error('Failed to retrieve idempotency key', {
      idempotencyKey,
      error: error.message,
    });
    return null; // fail open — let the request proceed
  }
};

/**
 * Deletes all expired idempotency keys.
 *
 * Schedule this with a cron job — once per day at a quiet time is sufficient
 * given the 24-hour TTL.
 *
 * @returns {Promise<number>}  number of rows deleted
 *
 * @example
 * // In your cron setup (e.g. node-cron):
 * import { cleanupExpiredIdempotencyKeys } from '#middleware/idempotency.middleware.js';
 *
 * cron.schedule('0 2 * * *', async () => {
 *   const deleted = await cleanupExpiredIdempotencyKeys();
 *   logger.info(`Idempotency cleanup: removed ${deleted} expired keys`);
 * });
 */
export const cleanupExpiredIdempotencyKeys = async () => {
  try {
    const result = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expires_at, new Date()))
      .returning({ id: idempotencyKeys.id });

    const deletedCount = result.length;

    logger.info('Idempotency key cleanup completed', { deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Failed to cleanup expired idempotency keys', {
      error: error.message,
    });
    return 0;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that enforces idempotency on mutation endpoints.
 *
 * Behaviour summary:
 *  • GET / HEAD / OPTIONS  → pass through immediately (safe methods)
 *  • No header present     → pass through (opt-in; client chose not to use it)
 *  • Invalid UUID format   → 400 Bad Request
 *  • Key found (completed) → 200/201/etc. replay with Idempotency-Replay: true
 *  • Key found (processing)→ 409 Conflict  (concurrent duplicate in-flight)
 *  • Key not found         → insert 'processing' row, run handler, capture response
 *  • Insert collision      → 409 Conflict  (race condition won by another process)
 *  • DB error on lookup    → fail open (log error, let request through)
 *
 * @param {Object}  [options]
 * @param {number}  [options.cacheDurationMs=86400000]  TTL for cached responses
 * @returns {import('express').RequestHandler}
 */
export const idempotencyMiddleware = (options = {}) => {
  const { cacheDurationMs = DEFAULT_CACHE_DURATION_MS } = options;

  return async (req, res, next) => {
    // ── 1. Safe methods never need idempotency ────────────────────────────
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    const idempotencyKey = req.get('Idempotency-Key');

    // ── 2. No header — client opted out; proceed normally ─────────────────
    if (!idempotencyKey) {
      logger.debug('Mutation without Idempotency-Key header', {
        method: req.method,
        path: req.path,
        userId: req.user?.id,
      });
      return next();
    }

    // ── 3. Validate the key is a proper UUID v4 ───────────────────────────
    if (!isValidIdempotencyKey(idempotencyKey)) {
      logger.warn('Rejected invalid Idempotency-Key format', {
        idempotencyKey,
        userId: req.user?.id,
        path: req.path,
      });
      return res.status(400).json({
        error: 'Invalid Idempotency-Key',
        message:
          'Idempotency-Key must be a valid UUID v4 ' +
          '(e.g. 550e8400-e29b-41d4-a716-446655440000). ' +
          'Generate one with: crypto.randomUUID()',
      });
    }

    // ── 4. Check for an existing completed response ───────────────────────
    const cached = await getIdempotencyKey(idempotencyKey);

    if (cached) {
      logger.info('Idempotent replay — returning cached response', {
        idempotencyKey,
        userId: req.user?.id,
        endpoint: req.path,
        replayCount: cached.accessed_count, // already incremented in getIdempotencyKey
        originalStatus: cached.response_status,
      });

      return res
        .status(cached.response_status)
        .set('Idempotency-Replay', 'true')
        .json(cached.response_body);
    }

    // ── 5. New key — attempt to claim it with an INSERT ───────────────────
    let row;
    try {
      row = await insertIdempotencyKey(
        idempotencyKey,
        req.path,
        req.user?.id ?? null,
        req.body,
        cacheDurationMs
      );
    } catch (dbError) {
      // Unexpected DB error — fail open so we don't block the user entirely.
      // The request proceeds without idempotency protection this one time.
      logger.error('Idempotency INSERT failed unexpectedly — failing open', {
        idempotencyKey,
        error: dbError.message,
        userId: req.user?.id,
      });
      return next();
    }

    // ── 6. INSERT returned null → unique collision → concurrent duplicate ─
    if (!row) {
      logger.warn('Idempotency key in-flight — concurrent duplicate blocked', {
        idempotencyKey,
        userId: req.user?.id,
        path: req.path,
      });
      return res.status(409).json({
        error: 'Conflict',
        message:
          'A request with this Idempotency-Key is already being processed. ' +
          'Wait for the original request to complete before retrying.',
        idempotency_key: idempotencyKey,
      });
    }

    // ── 7. We own the key — intercept res.json() to capture the response ──
    //
    // This pattern wraps the framework's json() method.  When the handler
    // eventually calls res.json(data), we:
    //   a) Persist the response to the DB (async, non-blocking).
    //   b) Delegate to the original json() so the actual HTTP response goes out.
    //
    // Important: we restore the original method before calling it to avoid
    // infinite recursion if the handler calls res.json() more than once.
    const originalJson = res.json.bind(res);

    res.json = function captureAndStore(data) {
      // Restore immediately — any further res.json calls go straight through.
      res.json = originalJson;

      // Persist asynchronously — don't make the client wait for the DB write.
      completeIdempotencyKey(idempotencyKey, res.statusCode, data).catch(
        err => {
          // Already logged inside completeIdempotencyKey.
          // The response still goes out normally; we just lose replay cache.
          logger.error('Idempotency completion write failed', {
            idempotencyKey,
            error: err.message,
          });
        }
      );

      // Send the response to the client.
      return originalJson(data);
    };

    // ── 8. Proceed to the actual route handler ────────────────────────────
    next();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// MONITORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns live statistics about idempotency key usage.
 * Useful for dashboards and ops monitoring.
 *
 * @returns {Promise<{totalKeys: number, activeKeys: number, processingKeys: number, replayedRequests: number}>}
 *
 * @example
 * const stats = await getIdempotencyStats();
 * // { totalKeys: 4821, activeKeys: 312, processingKeys: 2, replayedRequests: 47 }
 */
export const getIdempotencyStats = async () => {
  try {
    const now = new Date();

    const all = await db.select().from(idempotencyKeys);

    const active = all.filter(
      r => r.expires_at > now && r.status === 'completed'
    );
    const processing = all.filter(r => r.status === 'processing');
    const replayed = all.filter(r => r.accessed_count > 0);

    return {
      totalKeys: all.length,
      activeKeys: active.length,
      processingKeys: processing.length,
      replayedRequests: replayed.length,
    };
  } catch (error) {
    logger.error('Failed to get idempotency stats', { error: error.message });
    return {
      totalKeys: 0,
      activeKeys: 0,
      processingKeys: 0,
      replayedRequests: 0,
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NAMED + DEFAULT EXPORTS  (keeps existing import patterns working)
// ─────────────────────────────────────────────────────────────────────────────

export default {
  isValidIdempotencyKey,
  insertIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyKey,
  cleanupExpiredIdempotencyKeys,
  idempotencyMiddleware,
  getIdempotencyStats,
};
