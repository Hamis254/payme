import logger from '#config/logger.js';
import { db } from '#config/database.js';
import {
  offlineQueue,
  offlineSyncHistory,
  offlineLocalData,
  offlineConfig,
} from '#models/offlineQueue.model.js';
import {
  eq,
  and,
  ne,
  desc,
  asc,
  lte,
  lt,
} from 'drizzle-orm';

/**
 * Add operation to offline queue
 * Called when request fails due to network error
 */
export const queueOfflineOperation = async (data) => {
  const {
    userId,
    businessId,
    operationType,
    operationId,
    endpoint,
    method,
    requestBody,
    requestHeaders,
    executedAt = new Date(),
    deviceId,
  } = data;

  logger.info('Queueing offline operation', {
    operationType,
    operationId,
    userId,
    businessId,
  });

  try {
    const [queuedOp] = await db
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
        executed_at: executedAt,
        device_id: deviceId,
      })
      .returning();

    return queuedOp;
  } catch (error) {
    logger.error('Error queueing offline operation', error);
    throw error;
  }
};

/**
 * Get all pending operations for a business
 */
export const getPendingOperations = async (businessId, options = {}) => {
  const {
    status = 'pending',
    limit = 100,
    offset = 0,
  } = options;

  try {
    const operations = await db
      .select()
      .from(offlineQueue)
      .where(
        and(
          eq(offlineQueue.business_id, businessId),
          status ? eq(offlineQueue.status, status) : undefined
        )
      )
      .orderBy(asc(offlineQueue.created_at))
      .limit(limit)
      .offset(offset);

    return operations;
  } catch (error) {
    logger.error('Error getting pending operations', error);
    throw error;
  }
};

/**
 * Sync a single operation with the server
 * Handles conflict resolution
 */
export const syncOperation = async (queueId, serverResponse) => {
  logger.info('Syncing offline operation', { queueId });

  try {
    const [operation] = await db
      .select()
      .from(offlineQueue)
      .where(eq(offlineQueue.id, queueId));

    if (!operation) {
      throw new Error(`Operation not found: ${queueId}`);
    }

    // Check for conflicts
    const conflict = detectConflict(operation, serverResponse);

    if (conflict) {
      logger.warn('Conflict detected during sync', { queueId, conflict });
      return updateOperationStatus(queueId, 'conflict', {
        conflictType: conflict.type,
        conflictData: conflict.data,
        resolutionStrategy: 'manual',
      });
    }

    // Sync successful
    await db
      .update(offlineQueue)
      .set({
        status: 'synced',
        server_response: serverResponse,
        server_id: serverResponse?.id || serverResponse?.data?.id,
        synced_at: new Date(),
        sync_attempts: operation.sync_attempts + 1,
      })
      .where(eq(offlineQueue.id, queueId));

    // Record sync history
    await recordSyncHistory(queueId, 'success', serverResponse);

    logger.info('Operation synced successfully', { queueId });
    return { success: true, queueId };
  } catch (error) {
    logger.error('Error syncing operation', error);
    await recordSyncHistory(queueId, 'failed', { error: error.message });
    throw error;
  }
};

/**
 * Detect conflicts between local and server data
 * Returns conflict info if found, null otherwise
 */
const detectConflict = (localOperation, serverResponse) => {
  // Check for duplicate operation (idempotency)
  if (serverResponse?.error?.code === 'DUPLICATE_OPERATION') {
    return {
      type: 'duplicate',
      data: serverResponse,
    };
  }

  // Check for version mismatch (resource modified on server)
  if (serverResponse?.error?.code === 'VERSION_MISMATCH') {
    return {
      type: 'version_mismatch',
      data: serverResponse,
    };
  }

  // Check for resource deleted
  if (serverResponse?.error?.code === 'RESOURCE_NOT_FOUND') {
    return {
      type: 'deleted',
      data: serverResponse,
    };
  }

  return null;
};

/**
 * Resolve conflict using specified strategy
 */
export const resolveConflict = async (queueId, strategy) => {
  const validStrategies = ['client_wins', 'server_wins', 'merge', 'manual'];
  if (!validStrategies.includes(strategy)) {
    throw new Error(`Invalid resolution strategy: ${strategy}`);
  }

  logger.info('Resolving conflict', { queueId, strategy });

  try {
    await db
      .update(offlineQueue)
      .set({
        resolution_strategy: strategy,
        resolved_at: new Date(),
        status: strategy === 'client_wins' ? 'pending' : 'synced',
      })
      .where(eq(offlineQueue.id, queueId));

    logger.info('Conflict resolved', { queueId, strategy });
    return { success: true, queueId };
  } catch (error) {
    logger.error('Error resolving conflict', error);
    throw error;
  }
};

/**
 * Retry failed sync operations
 */
export const retryFailedOperations = async (businessId) => {
  logger.info('Retrying failed operations', { businessId });

  try {
    const failedOps = await db
      .select()
      .from(offlineQueue)
      .where(
        and(
          eq(offlineQueue.business_id, businessId),
          eq(offlineQueue.status, 'failed'),
          lt(offlineQueue.sync_attempts, offlineQueue.max_retries)
        )
      )
      .orderBy(asc(offlineQueue.failed_at));

    const results = [];
    for (const op of failedOps) {
      try {
        await db
          .update(offlineQueue)
          .set({
            status: 'pending',
            sync_attempts: op.sync_attempts + 1,
            last_error: null,
          })
          .where(eq(offlineQueue.id, op.id));

        results.push({ id: op.id, status: 'retrying' });
      } catch (error) {
        logger.error('Error retrying operation', error);
        results.push({ id: op.id, status: 'error', error: error.message });
      }
    }

    return results;
  } catch (error) {
    logger.error('Error retrying failed operations', error);
    throw error;
  }
};

/**
 * Sync all pending operations for a business
 */
export const syncAllPendingOperations = async (businessId, syncFunction) => {
  logger.info('Syncing all pending operations', { businessId });

  const startTime = Date.now();
  const results = { success: 0, failed: 0, conflict: 0, total: 0 };

  try {
    const pendingOps = await getPendingOperations(businessId, {
      status: 'pending',
      limit: 1000,
    });

    results.total = pendingOps.length;

    for (const op of pendingOps) {
      try {
        // Mark as syncing
        await updateOperationStatus(op.id, 'syncing');

        // Call provided sync function (typically makes API call)
        const response = await syncFunction(op);

        // Update operation
        await syncOperation(op.id, response);
        results.success += 1;
      } catch (error) {
        logger.error('Failed to sync operation', error);
        await handleSyncFailure(op.id, error);
        results.failed += 1;
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Batch sync completed', {
      businessId,
      ...results,
      durationMs: duration,
    });

    return { ...results, durationMs: duration };
  } catch (error) {
    logger.error('Error syncing pending operations', error);
    throw error;
  }
};

/**
 * Handle sync failure
 */
const handleSyncFailure = async (queueId, error) => {
  const [operation] = await db
    .select()
    .from(offlineQueue)
    .where(eq(offlineQueue.id, queueId));

  if (!operation) return;

  const isNetworkError = error.message.includes('Network') ||
    error.message.includes('timeout') ||
    error.message.includes('ECONNREFUSED');

  const errorCode = isNetworkError ? 'NETWORK' : 'SERVER_ERROR';
  const newAttempts = operation.sync_attempts + 1;

  if (newAttempts >= operation.max_retries) {
    // Max retries reached
    await db
      .update(offlineQueue)
      .set({
        status: 'failed',
        sync_attempts: newAttempts,
        last_error: error.message,
        error_code: errorCode,
        failed_at: new Date(),
      })
      .where(eq(offlineQueue.id, queueId));

    logger.warn('Operation exceeded max retries', { queueId, attempts: newAttempts });
  } else {
    // Retry later
    await db
      .update(offlineQueue)
      .set({
        status: 'pending',
        sync_attempts: newAttempts,
        last_error: error.message,
        error_code: errorCode,
      })
      .where(eq(offlineQueue.id, queueId));
  }
};

/**
 * Update operation status
 */
const updateOperationStatus = async (queueId, status, additionalData = {}) => {
  const updateData = {
    status,
    ...additionalData,
  };

  if (additionalData.conflictType) {
    updateData.conflict_type = additionalData.conflictType;
    updateData.conflict_data = additionalData.conflictData;
  }
  if (additionalData.resolutionStrategy) {
    updateData.resolution_strategy = additionalData.resolutionStrategy;
  }

  await db.update(offlineQueue).set(updateData).where(eq(offlineQueue.id, queueId));
};

/**
 * Record sync history
 */
const recordSyncHistory = async (queueId, syncStatus, responseData) => {
  const [operation] = await db
    .select()
    .from(offlineQueue)
    .where(eq(offlineQueue.id, queueId));

  if (!operation) return;

  try {
    await db.insert(offlineSyncHistory).values({
      queue_id: queueId,
      user_id: operation.user_id,
      sync_type: 'automatic',
      status: syncStatus,
      response_data: responseData,
      device_id: operation.device_id,
    });
  } catch (error) {
    logger.error('Error recording sync history', error);
  }
};

/**
 * Get sync status for business
 */
export const getSyncStatus = async (businessId) => {
  try {
    const pending = await db
      .select()
      .from(offlineQueue)
      .where(
        and(
          eq(offlineQueue.business_id, businessId),
          eq(offlineQueue.status, 'pending')
        )
      );

    const synced = await db
      .select()
      .from(offlineQueue)
      .where(
        and(
          eq(offlineQueue.business_id, businessId),
          eq(offlineQueue.status, 'synced')
        )
      );

    const conflicts = await db
      .select()
      .from(offlineQueue)
      .where(
        and(
          eq(offlineQueue.business_id, businessId),
          eq(offlineQueue.status, 'conflict')
        )
      );

    const failed = await db
      .select()
      .from(offlineQueue)
      .where(
        and(
          eq(offlineQueue.business_id, businessId),
          eq(offlineQueue.status, 'failed')
        )
      );

    return {
      pending: pending.length,
      synced: synced.length,
      conflicts: conflicts.length,
      failed: failed.length,
      total: pending.length + synced.length + conflicts.length + failed.length,
      lastSync: synced.length > 0 ? synced[0]?.synced_at : null,
    };
  } catch (error) {
    logger.error('Error getting sync status', error);
    throw error;
  }
};

/**
 * Clear synced operations (cleanup)
 */
export const clearSyncedOperations = async (businessId, olderThanDays = 7) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  try {
    const result = await db
      .delete(offlineQueue)
      .where(
        and(
          eq(offlineQueue.business_id, businessId),
          eq(offlineQueue.status, 'synced'),
          lte(offlineQueue.synced_at, cutoffDate)
        )
      );

    logger.info('Cleared synced operations', {
      businessId,
      olderThanDays,
      deletedCount: result.rowCount,
    });

    return { deleted: result.rowCount };
  } catch (error) {
    logger.error('Error clearing synced operations', error);
    throw error;
  }
};

/**
 * Get offline configuration for business
 */
export const getOfflineConfig = async (businessId) => {
  try {
    const [config] = await db
      .select()
      .from(offlineConfig)
      .where(eq(offlineConfig.business_id, businessId));

    return config || null;
  } catch (error) {
    logger.error('Error getting offline config', error);
    throw error;
  }
};

/**
 * Update offline configuration
 */
export const updateOfflineConfig = async (businessId, updates) => {
  try {
    const [updated] = await db
      .update(offlineConfig)
      .set(updates)
      .where(eq(offlineConfig.business_id, businessId))
      .returning();

    logger.info('Offline config updated', { businessId });
    return updated;
  } catch (error) {
    logger.error('Error updating offline config', error);
    throw error;
  }
};

/**
 * Get sync history for operation
 */
export const getSyncHistory = async (queueId, limit = 10) => {
  try {
    const history = await db
      .select()
      .from(offlineSyncHistory)
      .where(eq(offlineSyncHistory.queue_id, queueId))
      .orderBy(desc(offlineSyncHistory.started_at))
      .limit(limit);

    return history;
  } catch (error) {
    logger.error('Error getting sync history', error);
    throw error;
  }
};
