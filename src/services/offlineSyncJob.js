/**
 * =============================================================================
 * MIDDLEWARE: OFFLINE QUEUE
 * =============================================================================
 *
 * WHAT THIS MIDDLEWARE ACTUALLY DOES
 * ────────────────────────────────────
 * The client (mobile app / PWA) sends an `X-Is-Online: false` header whenever
 * it knows it has no connectivity.  This middleware intercepts that signal
 * BEFORE the route handler runs, saves the full request to the offline_queue
 * table, and returns 202 Accepted immediately.  The route handler never runs.
 *
 * When the device comes back online it calls POST /api/offline/sync (the
 * existing route) or the background job in offlineSyncJob picks up the row
 * automatically within the configured interval.
 *
 * FLOW
 * ─────
 *   Device online  → header absent or X-Is-Online: true  → next() — normal flow
 *   Device offline → X-Is-Online: false                  → queue + 202
 *   Operation type not allowed offline                    → 403
 *
 * APPLYING THE MIDDLEWARE
 * ────────────────────────
 * Add it to routes that make sense to queue offline.  Read-only routes (GET)
 * never need it — the client will just show stale data.
 *
 *   // In payme.routes.js
 *   import { offlineQueueMiddleware } from '#middleware/offline.middleware.js';
 *   router.post('/', offlineQueueMiddleware('sale'), idempotencyMiddleware(), ...);
 *
 *   // In expense.routes.js
 *   router.post('/:businessId/record', offlineQueueMiddleware('expense'), ...);
 *
 * CLIENT CONTRACT
 * ────────────────
 * Header the client sends:
 *   X-Is-Online: false          → queue this request
 *   X-Device-Id: <uuid>         → identifies the device (for sync tracking)
 *
 * Response the client gets on queue:
 *   HTTP 202 Accepted
 *   {
 *     "queued": true,
 *     "queue_id": 42,
 *     "operation_id": "sale_1748000000000",
 *     "message": "Saved offline. Will sync automatically when connection returns.",
 *     "sync_status": { "status": "pending", "queue_id": 42 }
 *   }
 *
 * @module middleware/offline
 * =============================================================================
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { offlineQueue, offlineConfig } from '#models/offlineQueue.model.js';
import { eq } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map of operation types to their offline permission field in offlineConfig.
 * If a type isn't listed here it is NOT queueable offline.
 */
const OFFLINE_PERMISSION_MAP = {
  sale: 'allow_sales_offline',
  expense: 'allow_expenses_offline',
  stock_adjustment: 'allow_stock_adjustment_offline',
};

/**
 * Fetch the business's offline config row (if it exists).
 * Returns null when no config row has been created — caller treats that as
 * "default config" (sales and expenses allowed, stock adjustment not).
 *
 * @param {number} businessId
 * @returns {Promise<Object|null>}
 */
const getOfflineConfigForBusiness = async businessId => {
  try {
    const [config] = await db
      .select()
      .from(offlineConfig)
      .where(eq(offlineConfig.business_id, businessId))
      .limit(1);
    return config ?? null;
  } catch (err) {
    logger.error('offlineQueueMiddleware: failed to read offline config', {
      businessId,
      error: err.message,
    });
    return null; // fail open — default permissions apply
  }
};

/**
 * Check whether a given operation type is permitted to be queued offline for
 * this business, based on their offlineConfig row.
 *
 * @param {string}      operationType  - 'sale' | 'expense' | 'stock_adjustment'
 * @param {Object|null} config         - offlineConfig row, or null for defaults
 * @returns {boolean}
 */
const isOperationAllowedOffline = (operationType, config) => {
  const permissionField = OFFLINE_PERMISSION_MAP[operationType];

  if (!permissionField) {
    // Unknown operation type — not supported offline
    return false;
  }

  if (!config) {
    // No config row → use hardcoded defaults:
    // sales ✓  expenses ✓  stock_adjustment ✗
    return operationType !== 'stock_adjustment';
  }

  // offlineConfig.offline_mode_enabled = false overrides everything
  if (!config.offline_mode_enabled) return false;

  return config[permissionField] === true;
};

/**
 * Insert a row into offline_queue.
 * Returns the created row.
 *
 * @param {Object} params
 * @returns {Promise<Object>} the created queue row
 */
const insertIntoQueue = async ({
  userId,
  businessId,
  operationType,
  operationId,
  endpoint,
  method,
  requestBody,
  requestHeaders,
  deviceId,
}) => {
  const [row] = await db
    .insert(offlineQueue)
    .values({
      user_id: userId,
      business_id: businessId,
      operation_type: operationType,
      operation_id: operationId,
      endpoint,
      method,
      request_body: requestBody,
      request_headers: requestHeaders,
      status: 'pending',
      sync_attempts: 0,
      executed_at: new Date(),
      device_id: deviceId ?? null,
    })
    .returning();

  return row;
};

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that short-circuits offline requests.
 *
 * @param {string} operationType - 'sale' | 'expense' | 'stock_adjustment'
 *                                  Used for permission checking and labelling
 *                                  the queue row's operation_type column.
 * @returns {import('express').RequestHandler}
 *
 * @example
 * // payme.routes.js
 * router.post('/', offlineQueueMiddleware('sale'), idempotencyMiddleware(), processPayMe);
 *
 * // expense.routes.js
 * router.post('/:businessId/record', offlineQueueMiddleware('expense'), recordExpenseHandler);
 */
export const offlineQueueMiddleware = (operationType = 'unknown') => {
  return async (req, res, next) => {
    // ── Only intercept when the client explicitly says it's offline ──────────
    // Any value other than the string 'false' is treated as online.
    const isOffline = req.headers['x-is-online'] === 'false';

    if (!isOffline) {
      return next(); // device is online — run the handler normally
    }

    // ── We need a user and a business to queue anything meaningful ───────────
    const userId = req.user?.id;
    const businessId =
      req.business?.id ?? // set by validateBusinessId middleware
      req.body?.business_id ??
      req.body?.businessId ??
      null;

    if (!userId || !businessId) {
      logger.warn('offlineQueueMiddleware: missing user or business context', {
        userId,
        businessId,
        path: req.path,
      });
      // Can't queue without ownership context — fall through to handler which
      // will return a proper 401/400.
      return next();
    }

    // ── Check whether this operation is allowed to be queued offline ─────────
    const config = await getOfflineConfigForBusiness(businessId);

    if (!isOperationAllowedOffline(operationType, config)) {
      logger.info('offlineQueueMiddleware: operation not allowed offline', {
        operationType,
        businessId,
        userId,
      });
      return res.status(403).json({
        success: false,
        queued: false,
        error: 'Offline not supported for this operation',
        message: `${operationType} operations cannot be queued for offline sync. Internet connection required.`,
        offline_available: false,
      });
    }

    // ── Build a stable operation ID ──────────────────────────────────────────
    // Include the user-supplied Idempotency-Key if present so the sync job can
    // forward it when it replays the request, preserving end-to-end idempotency.
    const idempotencyKey = req.get('Idempotency-Key');
    const operationId = idempotencyKey
      ? `${operationType}_${idempotencyKey}`
      : `${operationType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Strip the cookie header — it contains the JWT token which will have
    // expired by the time the background job replays this hours later.
    // The queue row stores user_id so the job can forge a valid auth context.
    const safeHeaders = {
      'content-type': req.get('content-type') ?? 'application/json',
      'x-device-id': req.headers['x-device-id'] ?? null,
      'idempotency-key': idempotencyKey ?? null,
    };

    // ── Insert into the queue ────────────────────────────────────────────────
    try {
      const queued = await insertIntoQueue({
        userId,
        businessId,
        operationType,
        operationId,
        endpoint: req.originalUrl || req.path,
        method: req.method,
        requestBody: req.body,
        requestHeaders: safeHeaders,
        deviceId: req.headers['x-device-id'] ?? null,
      });

      logger.info('Operation queued for offline sync', {
        queueId: queued.id,
        operationId,
        operationType,
        businessId,
        userId,
        endpoint: req.path,
      });

      // ── Return 202 Accepted immediately — do NOT call next() ──────────────
      return res.status(202).json({
        success: true,
        queued: true,
        queue_id: queued.id,
        operation_id: queued.operation_id,
        message:
          'Saved offline. Will sync automatically when connection returns.',
        sync_status: {
          status: 'pending',
          queue_id: queued.id,
        },
      });
    } catch (dbError) {
      logger.error('offlineQueueMiddleware: failed to insert queue row', {
        operationType,
        businessId,
        userId,
        error: dbError.message,
      });

      // Fail open — let the request reach the handler so the user isn't
      // completely blocked.  The handler will likely also fail if truly offline,
      // but that's better than a confusing 500 from the middleware.
      return next();
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY MIDDLEWARE (unchanged from original — kept for compatibility)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches device connectivity status to req.deviceStatus.
 * Apply globally in app.js so all handlers can read it.
 */
export const setDeviceStatus = (req, _res, next) => {
  const isOnline = req.headers['x-is-online'] !== 'false';
  const deviceId = req.headers['x-device-id'];

  req.deviceStatus = {
    deviceId: deviceId ?? null,
    isOnline,
    timestamp: new Date(),
  };

  next();
};

/**
 * Blocks requests from devices that declare themselves offline, when the
 * endpoint cannot be deferred (e.g. M-Pesa STK push requires live network).
 */
export const requireOnline = (req, res, next) => {
  const isOnline = req.headers['x-is-online'] !== 'false';

  if (!isOnline) {
    return res.status(503).json({
      success: false,
      error: 'Internet connection required',
      message: 'This operation cannot be performed offline.',
      retryable: true,
    });
  }

  next();
};

/**
 * Adds offline-capability hint headers to every response so the client knows
 * this server supports the offline queue protocol.
 */
export const offlineCapabilityHeaders = (_req, res, next) => {
  res.set('X-Sync-Capable', 'true');
  res.set('X-Offline-Protocol-Version', '1');
  next();
};

export default {
  offlineQueueMiddleware,
  setDeviceStatus,
  requireOnline,
  offlineCapabilityHeaders,
};
