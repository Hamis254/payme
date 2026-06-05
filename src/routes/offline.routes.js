/**
 * =============================================================================
 * ROUTES: OFFLINE SYNC
 * =============================================================================
 *
 * Mount point: /api/offline  (set in app.js)
 *
 * IMPORT MAP  (why each function comes from where it does)
 * ─────────────────────────────────────────────────────────
 * offlineSync.service.js  — pure DB operations: querying the offline_queue
 *   table, updating config, reading history.  No HTTP calls, no scheduling.
 *   Used directly by the route handlers below.
 *
 * offlineSyncJob.js       — the background scheduler (setInterval).
 *   Exports startOfflineSyncJob / stopOfflineSyncJob (called by server.js) and
 *   runSyncCycle — the only export used here.  POST /sync triggers one cycle
 *   on demand so a client can force an immediate flush without waiting for the
 *   next scheduled tick.
 *
 * All routes were previously working.  The only change here is:
 *   1. Import source for sync trigger:  offlineSync.service → offlineSyncJob
 *   2. POST /sync handler: calls runSyncCycle() instead of the old
 *      syncAllPendingOperations(businessId, mockSyncFunction) which never
 *      actually made real HTTP calls — it just returned a fake success.
 *
 * =============================================================================
 */

import { Router } from 'express';
import { authenticateToken }    from '#middleware/auth.middleware.js';
import { validateBusinessId }   from '#middleware/businessId.middleware.js';
import logger                   from '#config/logger.js';
import {
  queueOfflineOperation,
  getPendingOperations,
  syncOperation,
  resolveConflict,
  retryFailedOperations,
  getSyncStatus,
  getOfflineConfig,
  updateOfflineConfig,
  getSyncHistory,
  clearSyncedOperations,
} from '#services/offlineSync.service.js';

// runSyncCycle is the only thing we need from the job in these routes.
// startOfflineSyncJob / stopOfflineSyncJob are called by server.js only.
import { runSyncCycle } from '#services/offlineSyncJob.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/offline/status
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/status',
  authenticateToken,
  validateBusinessId('query'),
  async (req, res, next) => {
    try {
      const businessId = req.businessId ?? req.query.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId required' });

      const status = await getSyncStatus(businessId);
      return res.json({ success: true, syncStatus: status });
    } catch (error) {
      logger.error('Error getting sync status', error);
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/offline/queue  (manual queue — for testing / edge cases)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/queue',
  authenticateToken,
  validateBusinessId('body'),
  async (req, res, next) => {
    try {
      const { operationType, endpoint, method = 'POST', requestBody } = req.body;

      if (!operationType || !endpoint) {
        return res.status(400).json({ error: 'operationType and endpoint required' });
      }

      const queued = await queueOfflineOperation({
        userId:        req.user.id,
        businessId:    req.businessId,
        operationType,
        operationId:   `${operationType}_${Date.now()}`,
        endpoint,
        method,
        requestBody,
        deviceId:      req.headers['x-device-id'],
      });

      return res.status(201).json({
        success:  true,
        queueId:  queued.id,
        message:  'Operation queued successfully',
      });
    } catch (error) {
      logger.error('Error queueing operation', error);
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/offline/pending
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/pending',
  authenticateToken,
  validateBusinessId('query'),
  async (req, res, next) => {
    try {
      const businessId = req.businessId ?? req.query.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId required' });

      const limit      = parseInt(req.query.limit  ?? '100', 10);
      const offset     = parseInt(req.query.offset ?? '0',   10);

      const operations = await getPendingOperations(businessId, { status: 'pending', limit, offset });

      return res.json({ success: true, operations, count: operations.length, limit, offset });
    } catch (error) {
      logger.error('Error getting pending operations', error);
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/offline/sync   — trigger one background-job cycle immediately
// ─────────────────────────────────────────────────────────────────────────────
//
// Previously called syncAllPendingOperations(businessId, mockSyncFunction)
// which passed a mock that never hit a real endpoint — it returned fake JSON.
// Now calls runSyncCycle() which makes real internal HTTP calls with proper
// JWT auth and processes ALL pending rows (not just for one business) — the
// same work the scheduler would do on the next tick.

router.post(
  '/sync',
  authenticateToken,
  async (req, res, next) => {
    try {
      logger.info('Manual sync triggered', { userId: req.user.id });

      // runSyncCycle returns a summary object — run it and wait for completion
      const results = await runSyncCycle();

      return res.json({
        success:     true,
        syncResults: results,
        message:     `Sync cycle complete — ${results.synced} synced, ${results.failed} failed, ${results.retrying} retrying`,
      });
    } catch (error) {
      logger.error('Error triggering sync cycle', error);
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/offline/sync/:queueId  — mark a specific operation as synced
// ─────────────────────────────────────────────────────────────────────────────

router.post('/sync/:queueId', authenticateToken, async (req, res, next) => {
  try {
    const { queueId }      = req.params;
    const { serverResponse } = req.body;

    if (!queueId) return res.status(400).json({ error: 'queueId required' });

    const result = await syncOperation(parseInt(queueId, 10), serverResponse);
    return res.json({ success: true, result });
  } catch (error) {
    logger.error('Error syncing operation', error);
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/offline/resolve/:queueId
// ─────────────────────────────────────────────────────────────────────────────

router.post('/resolve/:queueId', authenticateToken, async (req, res, next) => {
  try {
    const { queueId }  = req.params;
    const { strategy } = req.body;

    if (!queueId || !strategy) {
      return res.status(400).json({ error: 'queueId and strategy required' });
    }

    const result = await resolveConflict(parseInt(queueId, 10), strategy);
    return res.json({ success: true, result, message: `Conflict resolved using ${strategy} strategy` });
  } catch (error) {
    logger.error('Error resolving conflict', error);
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/offline/retry
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/retry',
  authenticateToken,
  validateBusinessId('body'),
  async (req, res, next) => {
    try {
      const businessId = req.businessId ?? req.body.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId required' });

      const results = await retryFailedOperations(businessId);
      return res.json({ success: true, retried: results, count: results.length });
    } catch (error) {
      logger.error('Error retrying failed operations', error);
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/offline/config
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/config',
  authenticateToken,
  validateBusinessId('query'),
  async (req, res, next) => {
    try {
      const businessId = req.businessId ?? req.query.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId required' });

      const config = await getOfflineConfig(businessId);
      return res.json({
        success: true,
        config: config ?? {
          offline_mode_enabled:   true,
          auto_sync_enabled:      true,
          sync_interval_minutes:  5,
          allow_sales_offline:    true,
          allow_expenses_offline: true,
        },
      });
    } catch (error) {
      logger.error('Error getting offline config', error);
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/offline/config
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  '/config',
  authenticateToken,
  validateBusinessId('body'),
  async (req, res, next) => {
    try {
      const businessId = req.businessId ?? req.body.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId required' });

      const updates = req.body.updates ?? req.body;
      const updated = await updateOfflineConfig(businessId, updates);

      return res.json({ success: true, config: updated, message: 'Offline configuration updated' });
    } catch (error) {
      logger.error('Error updating offline config', error);
      next(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/offline/history/:queueId
// ─────────────────────────────────────────────────────────────────────────────

router.get('/history/:queueId', authenticateToken, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    if (!queueId) return res.status(400).json({ error: 'queueId required' });

    const limit   = parseInt(req.query.limit ?? '10', 10);
    const history = await getSyncHistory(parseInt(queueId, 10), limit);

    return res.json({ success: true, history, count: history.length });
  } catch (error) {
    logger.error('Error getting sync history', error);
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/offline/cleanup
// ─────────────────────────────────────────────────────────────────────────────

router.delete(
  '/cleanup',
  authenticateToken,
  validateBusinessId('body'),
  async (req, res, next) => {
    try {
      const businessId    = req.businessId ?? req.body.businessId;
      if (!businessId) return res.status(400).json({ error: 'businessId required' });

      const olderThanDays = parseInt(req.body.olderThanDays ?? '7', 10);
      const result        = await clearSyncedOperations(businessId, olderThanDays);

      return res.json({ success: true, deleted: result.deleted, message: `Cleaned up ${result.deleted} synced operations` });
    } catch (error) {
      logger.error('Error cleaning up synced operations', error);
      next(error);
    }
  }
);

export default router;