import { Router } from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import logger from '#config/logger.js';
import {
  queueOfflineOperation,
  getPendingOperations,
  syncOperation,
  resolveConflict,
  retryFailedOperations,
  syncAllPendingOperations,
  getSyncStatus,
  getOfflineConfig,
  updateOfflineConfig,
  getSyncHistory,
  clearSyncedOperations,
} from '#services/offlineSync.service.js';

const router = Router();

/**
 * GET /api/offline/status
 * Get sync status for business
 */
router.get('/status', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body.businessId || req.query.businessId;

    if (!businessId) {
      return res.status(400).json({
        error: 'businessId required',
      });
    }

    const status = await getSyncStatus(businessId);

    return res.json({
      success: true,
      syncStatus: status,
    });
  } catch (error) {
    logger.error('Error getting sync status', error);
    next(error);
  }
});

/**
 * POST /api/offline/queue
 * Add operation to offline queue manually (for testing)
 */
router.post('/queue', authenticateToken, async (req, res, next) => {
  try {
    const {
      operationType,
      endpoint,
      method = 'POST',
      requestBody,
    } = req.body;

    if (!operationType || !endpoint) {
      return res.status(400).json({
        error: 'operationType and endpoint required',
      });
    }

    const queued = await queueOfflineOperation({
      userId: req.user.id,
      businessId: req.user.businessId,
      operationType,
      operationId: `${operationType}_${Date.now()}`,
      endpoint,
      method,
      requestBody,
      deviceId: req.headers['x-device-id'],
    });

    return res.status(201).json({
      success: true,
      queueId: queued.id,
      message: 'Operation queued successfully',
    });
  } catch (error) {
    logger.error('Error queueing operation', error);
    next(error);
  }
});

/**
 * GET /api/offline/pending
 * Get all pending operations for business
 */
router.get('/pending', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body.businessId || req.query.businessId;
    const limit = parseInt(req.query.limit || 100);
    const offset = parseInt(req.query.offset || 0);

    if (!businessId) {
      return res.status(400).json({
        error: 'businessId required',
      });
    }

    const operations = await getPendingOperations(businessId, {
      status: 'pending',
      limit,
      offset,
    });

    return res.json({
      success: true,
      operations,
      count: operations.length,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Error getting pending operations', error);
    next(error);
  }
});

/**
 * POST /api/offline/sync
 * Sync all pending operations
 */
router.post('/sync', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body.businessId;
    const syncFunction = req.body.syncFunction || defaultSyncFunction;

    if (!businessId) {
      return res.status(400).json({
        error: 'businessId required',
      });
    }

    // Start sync in background
    const results = await syncAllPendingOperations(businessId, syncFunction);

    return res.json({
      success: true,
      syncResults: results,
      message: `Synced ${results.success} operations`,
    });
  } catch (error) {
    logger.error('Error syncing operations', error);
    next(error);
  }
});

/**
 * POST /api/offline/sync/:queueId
 * Sync specific operation
 */
router.post('/sync/:queueId', authenticateToken, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const { serverResponse } = req.body;

    if (!queueId) {
      return res.status(400).json({
        error: 'queueId required',
      });
    }

    const result = await syncOperation(parseInt(queueId), serverResponse);

    return res.json({
      success: true,
      result,
    });
  } catch (error) {
    logger.error('Error syncing operation', error);
    next(error);
  }
});

/**
 * POST /api/offline/resolve/:queueId
 * Resolve conflict
 */
router.post('/resolve/:queueId', authenticateToken, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const { strategy } = req.body;

    if (!queueId || !strategy) {
      return res.status(400).json({
        error: 'queueId and strategy required',
      });
    }

    const result = await resolveConflict(parseInt(queueId), strategy);

    return res.json({
      success: true,
      result,
      message: `Conflict resolved using ${strategy} strategy`,
    });
  } catch (error) {
    logger.error('Error resolving conflict', error);
    next(error);
  }
});

/**
 * POST /api/offline/retry
 * Retry failed operations
 */
router.post('/retry', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body.businessId;

    if (!businessId) {
      return res.status(400).json({
        error: 'businessId required',
      });
    }

    const results = await retryFailedOperations(businessId);

    return res.json({
      success: true,
      retried: results,
      count: results.length,
    });
  } catch (error) {
    logger.error('Error retrying failed operations', error);
    next(error);
  }
});

/**
 * GET /api/offline/config
 * Get offline configuration
 */
router.get('/config', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body.businessId || req.query.businessId;

    if (!businessId) {
      return res.status(400).json({
        error: 'businessId required',
      });
    }

    const config = await getOfflineConfig(businessId);

    return res.json({
      success: true,
      config: config || {
        offline_mode_enabled: true,
        auto_sync_enabled: true,
        sync_interval_minutes: 5,
        allow_sales_offline: true,
        allow_expenses_offline: true,
      },
    });
  } catch (error) {
    logger.error('Error getting offline config', error);
    next(error);
  }
});

/**
 * PATCH /api/offline/config
 * Update offline configuration
 */
router.patch('/config', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body.businessId;
    const updates = req.body.updates || req.body;

    if (!businessId) {
      return res.status(400).json({
        error: 'businessId required',
      });
    }

    const updated = await updateOfflineConfig(businessId, updates);

    return res.json({
      success: true,
      config: updated,
      message: 'Offline configuration updated',
    });
  } catch (error) {
    logger.error('Error updating offline config', error);
    next(error);
  }
});

/**
 * GET /api/offline/history/:queueId
 * Get sync history for operation
 */
router.get('/history/:queueId', authenticateToken, async (req, res, next) => {
  try {
    const { queueId } = req.params;
    const limit = parseInt(req.query.limit || 10);

    if (!queueId) {
      return res.status(400).json({
        error: 'queueId required',
      });
    }

    const history = await getSyncHistory(parseInt(queueId), limit);

    return res.json({
      success: true,
      history,
      count: history.length,
    });
  } catch (error) {
    logger.error('Error getting sync history', error);
    next(error);
  }
});

/**
 * DELETE /api/offline/cleanup
 * Clear old synced operations
 */
router.delete('/cleanup', authenticateToken, async (req, res, next) => {
  try {
    const businessId = req.body.businessId;
    const olderThanDays = parseInt(req.body.olderThanDays || 7);

    if (!businessId) {
      return res.status(400).json({
        error: 'businessId required',
      });
    }

    const result = await clearSyncedOperations(businessId, olderThanDays);

    return res.json({
      success: true,
      deleted: result.deleted,
      message: `Cleaned up ${result.deleted} synced operations`,
    });
  } catch (error) {
    logger.error('Error cleaning up synced operations', error);
    next(error);
  }
});

/**
 * Default sync function (can be overridden)
 */
const defaultSyncFunction = async (operation) => {
  logger.info('Default sync function called for operation', {
    id: operation.id,
    type: operation.operation_type,
  });

  // This would normally make an API call to sync the operation
  // For now, just return a mock success response
  return {
    success: true,
    id: operation.id,
    serverResponse: {
      id: `server_${operation.id}`,
      status: 'synced',
    },
  };
};

export default router;
