/**
 * =============================================================================
 * SERVICE: OFFLINE SYNC JOB  (background scheduler)
 * =============================================================================
 *
 * RESPONSIBILITY
 * ───────────────
 * Periodically scans the offline_queue table for pending rows and replays each
 * operation against the real API endpoint using an internal HTTP call.  This is
 * the automatic sync mechanism — no Redis, no worker threads, no external queue
 * service required.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Every N minutes (default: 5, env: OFFLINE_SYNC_INTERVAL_MS) the job wakes.
 * 2. Fetches all rows with status = 'pending' in created_at order (FIFO).
 * 3. For each row it:
 *    a. Claims the row atomically (UPDATE WHERE status = 'pending' → 'syncing').
 *       If two job instances race, only one wins — the other skips.
 *    b. Mints a short-lived JWT for the original user_id so the replayed
 *       request passes authenticateToken — the original cookie is long gone.
 *    c. Makes an internal axios call to the stored endpoint with the stored
 *       request_body and the fresh JWT in the Cookie header.
 *    d. 2xx  → marks row 'synced', writes sync history.
 *    e. 409  → idempotency hit → treats as 'synced' (already processed).
 *    f. 4xx  → marks 'failed', no retry — bad payload won't improve.
 *    g. 5xx / network error → increments sync_attempts; resets to 'pending'
 *       for next cycle unless max_retries exhausted, then marks 'failed'.
 * 4. Cleanup runs every 24 h — deletes 'synced' rows older than
 *    OFFLINE_SYNC_CLEANUP_HOURS (default: 24).
 *
 * STARTUP / SHUTDOWN
 * ───────────────────
 *   // server.js
 *   import { startOfflineSyncJob, stopOfflineSyncJob } from '#services/offlineSyncJob.js';
 *
 *   server.listen(PORT, () => { startOfflineSyncJob(); });
 *   process.on('SIGTERM', () => { stopOfflineSyncJob(); server.close(...); });
 *
 * ENV VARS (all optional)
 * ────────────────────────
 *   OFFLINE_SYNC_INTERVAL_MS   = 300000   (5 minutes between cycles)
 *   OFFLINE_SYNC_BATCH_SIZE    = 50       (rows processed per cycle)
 *   OFFLINE_SYNC_CLEANUP_HOURS = 24       (prune synced rows older than N hours)
 *   OFFLINE_SYNC_INTERNAL_URL  = http://localhost:3000
 *
 * @module services/offlineSyncJob
 * =============================================================================
 */

import axios from 'axios';
import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { offlineQueue, offlineSyncHistory } from '#models/offlineQueue.model.js';
import { eq, and, asc, lte } from 'drizzle-orm';
import { jwttoken } from '#utils/jwt.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  INTERVAL_MS:         parseInt(process.env.OFFLINE_SYNC_INTERVAL_MS   ?? '300000', 10),
  BATCH_SIZE:          parseInt(process.env.OFFLINE_SYNC_BATCH_SIZE     ?? '50',     10),
  CLEANUP_AFTER_HOURS: parseInt(process.env.OFFLINE_SYNC_CLEANUP_HOURS  ?? '24',     10),
  INTERNAL_BASE_URL:   process.env.OFFLINE_SYNC_INTERNAL_URL ?? 'http://localhost:3000',
  REQUEST_TIMEOUT_MS:  15000,
};

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

let syncIntervalHandle    = null;
let cleanupIntervalHandle = null;
let isRunning             = false; // prevents overlapping cycles

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mint a 2-minute JWT for the original user so the replayed request passes
 * authenticateToken.  The job signs with the same JWT_SECRET the middleware
 * validates — no special bypass, full auth chain runs normally.
 *
 * @param {number} userId
 * @param {string} [role='user']
 * @returns {string} signed JWT
 */
const mintInternalJwt = (userId, role = 'user') =>
  jwttoken.sign({ id: userId, name: 'offline_sync', role });

/**
 * Atomically claim a pending row by flipping status to 'syncing'.
 * Returns false if another instance already claimed it.
 *
 * @param {number} queueId
 * @returns {Promise<boolean>}
 */
const claimRow = async queueId => {
  try {
    const result = await db
      .update(offlineQueue)
      .set({ status: 'syncing' })
      .where(
        and(
          eq(offlineQueue.id, queueId),
          eq(offlineQueue.status, 'pending') // conditional update — only wins once
        )
      )
      .returning({ id: offlineQueue.id });

    return result.length > 0;
  } catch (err) {
    logger.error('offlineSyncJob: failed to claim row', { queueId, error: err.message });
    return false;
  }
};

/**
 * Make the internal HTTP call that replays the queued operation.
 *
 * @param {Object} row - offline_queue row
 * @returns {Promise<{ statusCode: number, data: Object }>}
 */
const replayOperation = async row => {
  const token = mintInternalJwt(row.user_id);

  const headers = {
    'Content-Type':     'application/json',
    'Cookie':           `token=${token}`,
    'X-Offline-Replay': 'true',  // tag so handlers can identify replays in logs
    'X-Queue-Id':       String(row.id),
    // Forward the original Idempotency-Key — deduplicates correctly on replay
    ...(row.request_headers?.['idempotency-key']
      ? { 'Idempotency-Key': row.request_headers['idempotency-key'] }
      : {}),
  };

  const response = await axios({
    method:         row.method.toLowerCase(),
    url:            `${CONFIG.INTERNAL_BASE_URL}${row.endpoint}`,
    data:           row.request_body,
    headers,
    timeout:        CONFIG.REQUEST_TIMEOUT_MS,
    validateStatus: () => true, // never throw on HTTP error status
  });

  return { statusCode: response.status, data: response.data };
};

/**
 * Write a row to offline_sync_history (non-fatal — never blocks the sync loop).
 */
const writeSyncHistory = async ({ queueId, userId, status, serverStatus, responseData, durationMs, errorMessage, deviceId }) => {
  try {
    await db.insert(offlineSyncHistory).values({
      queue_id:         queueId,
      user_id:          userId,
      sync_type:        'automatic',
      status,
      server_status:    serverStatus ?? null,
      response_data:    responseData ?? null,
      sync_duration_ms: durationMs,
      started_at:       new Date(Date.now() - durationMs),
      completed_at:     new Date(),
      error_message:    errorMessage ?? null,
      device_id:        deviceId ?? null,
    });
  } catch (err) {
    logger.error('offlineSyncJob: failed to write sync history', { queueId, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE: PROCESS ONE ROW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single queue row end-to-end.
 *
 * @param {Object} row
 * @returns {Promise<'synced'|'failed'|'retrying'|'skipped'>}
 */
const processRow = async row => {
  const started = Date.now();

  const claimed = await claimRow(row.id);
  if (!claimed) return 'skipped'; // another instance took it

  logger.info('offlineSyncJob: replaying operation', {
    queueId:       row.id,
    operationType: row.operation_type,
    endpoint:      row.endpoint,
    method:        row.method,
    userId:        row.user_id,
    attempt:       row.sync_attempts + 1,
  });

  try {
    const { statusCode, data } = await replayOperation(row);
    const durationMs = Date.now() - started;

    // ── 2xx — success ─────────────────────────────────────────────────────
    if (statusCode >= 200 && statusCode < 300) {
      await db.update(offlineQueue).set({
        status:          'synced',
        server_response: data,
        server_id:       data?.id ?? data?.data?.id ?? null,
        synced_at:       new Date(),
        sync_attempts:   row.sync_attempts + 1,
        last_error:      null,
        error_code:      null,
      }).where(eq(offlineQueue.id, row.id));

      await writeSyncHistory({ queueId: row.id, userId: row.user_id, status: 'success', serverStatus: statusCode, responseData: data, durationMs, deviceId: row.device_id });
      logger.info('offlineSyncJob: synced ✓', { queueId: row.id, statusCode, durationMs });
      return 'synced';
    }

    // ── 409 — idempotency hit — already processed, treat as synced ────────
    if (statusCode === 409) {
      await db.update(offlineQueue).set({
        status:          'synced',
        server_response: data,
        synced_at:       new Date(),
        sync_attempts:   row.sync_attempts + 1,
        last_error:      null,
      }).where(eq(offlineQueue.id, row.id));

      logger.info('offlineSyncJob: 409 idempotency hit — treating as synced', { queueId: row.id });
      return 'synced';
    }

    // ── Other 4xx — bad payload, no point retrying ────────────────────────
    if (statusCode >= 400 && statusCode < 500) {
      await db.update(offlineQueue).set({
        status:          'failed',
        server_response: data,
        sync_attempts:   row.sync_attempts + 1,
        last_error:      `HTTP ${statusCode}: ${data?.error ?? data?.message ?? 'Client error'}`,
        error_code:      'CLIENT_ERROR',
        failed_at:       new Date(),
      }).where(eq(offlineQueue.id, row.id));

      await writeSyncHistory({ queueId: row.id, userId: row.user_id, status: 'failed', serverStatus: statusCode, responseData: data, durationMs: Date.now() - started, errorMessage: `HTTP ${statusCode}`, deviceId: row.device_id });
      logger.warn('offlineSyncJob: permanent failure (4xx)', { queueId: row.id, statusCode });
      return 'failed';
    }

    // ── 5xx falls through to catch below ──────────────────────────────────
    throw new Error(`HTTP ${statusCode} from server`);

  } catch (err) {
    const durationMs  = Date.now() - started;
    const newAttempts = row.sync_attempts + 1;
    const isNetwork   = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(err.code) || err.message.includes('timeout');
    const errorCode   = isNetwork ? 'NETWORK' : 'SERVER_ERROR';

    if (newAttempts >= row.max_retries) {
      await db.update(offlineQueue).set({
        status:        'failed',
        sync_attempts: newAttempts,
        last_error:    err.message,
        error_code:    errorCode,
        failed_at:     new Date(),
      }).where(eq(offlineQueue.id, row.id));

      await writeSyncHistory({ queueId: row.id, userId: row.user_id, status: 'failed', durationMs, errorMessage: err.message, deviceId: row.device_id });
      logger.warn('offlineSyncJob: max retries exhausted', { queueId: row.id, attempts: newAttempts, error: err.message });
      return 'failed';
    }

    // Reset to pending for next cycle
    await db.update(offlineQueue).set({
      status:        'pending',
      sync_attempts: newAttempts,
      last_error:    err.message,
      error_code:    errorCode,
    }).where(eq(offlineQueue.id, row.id));

    await writeSyncHistory({ queueId: row.id, userId: row.user_id, status: 'failed', durationMs, errorMessage: err.message, deviceId: row.device_id });
    logger.info('offlineSyncJob: will retry', { queueId: row.id, attemptsUsed: newAttempts, remaining: row.max_retries - newAttempts });
    return 'retrying';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SYNC CYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run one full sync cycle: fetch pending rows → process each → log summary.
 * Exported so the manual /api/offline/sync route can trigger it on demand.
 *
 * @returns {Promise<{ synced: number, failed: number, retrying: number, skipped: number, total: number }>}
 */
export const runSyncCycle = async () => {
  if (isRunning) {
    logger.debug('offlineSyncJob: previous cycle still running — skipping');
    return { synced: 0, failed: 0, retrying: 0, skipped: 0, total: 0 };
  }

  isRunning = true;
  const cycleStart = Date.now();
  const results    = { synced: 0, failed: 0, retrying: 0, skipped: 0 };

  try {
    const rows = await db
      .select()
      .from(offlineQueue)
      .where(eq(offlineQueue.status, 'pending'))
      .orderBy(asc(offlineQueue.created_at))
      .limit(CONFIG.BATCH_SIZE);

    if (rows.length === 0) {
      logger.debug('offlineSyncJob: queue empty');
      return { ...results, total: 0 };
    }

    logger.info('offlineSyncJob: cycle started', { rowCount: rows.length });

    // Sequential processing — predictable logs, avoids DB connection storms.
    // Switch to p-limit(N) here if throughput becomes a bottleneck.
    for (const row of rows) {
      const outcome = await processRow(row);
      results[outcome] = (results[outcome] ?? 0) + 1;
    }

    logger.info('offlineSyncJob: cycle complete', {
      ...results,
      total: rows.length,
      durationMs: Date.now() - cycleStart,
    });

    return { ...results, total: rows.length };
  } catch (err) {
    logger.error('offlineSyncJob: unhandled error in cycle', { error: err.message, stack: err.stack });
    return { ...results, total: 0 };
  } finally {
    isRunning = false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

const runCleanup = async () => {
  const cutoff = new Date(Date.now() - CONFIG.CLEANUP_AFTER_HOURS * 60 * 60 * 1000);
  try {
    const deleted = await db
      .delete(offlineQueue)
      .where(and(eq(offlineQueue.status, 'synced'), lte(offlineQueue.synced_at, cutoff)))
      .returning({ id: offlineQueue.id });

    logger.info('offlineSyncJob: cleanup complete', { deletedCount: deleted.length, olderThanHours: CONFIG.CLEANUP_AFTER_HOURS });
  } catch (err) {
    logger.error('offlineSyncJob: cleanup failed', { error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the background sync job.
 * Runs immediately on startup to flush anything queued before last restart,
 * then on a fixed interval.  Safe to call multiple times — subsequent calls
 * are no-ops.
 */
export const startOfflineSyncJob = () => {
  if (syncIntervalHandle) {
    logger.warn('offlineSyncJob: already running — ignoring duplicate start');
    return;
  }

  logger.info('offlineSyncJob: starting', {
    intervalMs:        CONFIG.INTERVAL_MS,
    batchSize:         CONFIG.BATCH_SIZE,
    cleanupAfterHours: CONFIG.CLEANUP_AFTER_HOURS,
    internalBaseUrl:   CONFIG.INTERNAL_BASE_URL,
  });

  // Flush immediately on startup
  runSyncCycle().catch(err =>
    logger.error('offlineSyncJob: initial cycle failed', { error: err.message })
  );

  syncIntervalHandle    = setInterval(runSyncCycle, CONFIG.INTERVAL_MS);
  cleanupIntervalHandle = setInterval(runCleanup, 24 * 60 * 60 * 1000);
};

/**
 * Stop the sync job gracefully.
 * Call inside SIGTERM / SIGINT handlers before closing the HTTP server.
 */
export const stopOfflineSyncJob = () => {
  if (syncIntervalHandle)    clearInterval(syncIntervalHandle);
  if (cleanupIntervalHandle) clearInterval(cleanupIntervalHandle);
  syncIntervalHandle    = null;
  cleanupIntervalHandle = null;
  logger.info('offlineSyncJob: stopped');
};

export default { startOfflineSyncJob, stopOfflineSyncJob, runSyncCycle };