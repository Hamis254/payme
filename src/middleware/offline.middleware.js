import logger from '#config/logger.js';
import { queueOfflineOperation } from '#services/offlineSync.service.js';

/**
 * Offline Detection & Queueing Middleware
 * 
 * This middleware catches network errors and queues operations for later sync
 * It should be applied to routes that support offline mode
 */
export const offlineQueueMiddleware = (req, res, next) => {
  // Store original send method
  const originalSend = res.send;

  // Wrap send to catch network errors
  res.send = function (data) {
    // Continue normally for successful responses
    if (res.statusCode < 400) {
      return originalSend.call(this, data);
    }

    // For network/connection errors, don't queue here
    // Queue happens in the route handler's catch block
    return originalSend.call(this, data);
  };

  next();
};

/**
 * Error handler for offline operations
 * Call this in your route's catch block
 * 
 * Example:
 * catch (error) {
 *   return handleOfflineError(error, req, res, operationData);
 * }
 */
export const handleOfflineError = async (error, req, res, operationData) => {
  const isNetworkError = isOfflineError(error);

  if (!isNetworkError) {
    // Not a network error, let normal error handling deal with it
    return null;
  }

  // Network error - try to queue operation
  try {
    logger.warn('Network error detected, queueing operation for offline sync', {
      operation: operationData.operationType,
      error: error.message,
    });

    const {
      operationType,
      operationId,
      endpoint,
      method,
    } = operationData;

    // Queue the operation
    const queued = await queueOfflineOperation({
      userId: req.user?.id,
      businessId: req.business?.id,
      operationType,
      operationId: operationId || `${operationType}_${Date.now()}`,
      endpoint,
      method: method || req.method,
      requestBody: req.body,
      requestHeaders: {
        'content-type': req.get('content-type'),
        'authorization': req.get('authorization'),
      },
      executedAt: new Date(),
      deviceId: req.headers['x-device-id'],
    });

    // Return response indicating operation was queued
    return res.status(202).json({
      success: true,
      queued: true,
      queueId: queued.id,
      operationId: queued.operation_id,
      message: 'Operation queued for sync when connection is available',
      syncStatus: {
        status: 'pending',
        queueId: queued.id,
      },
    });
  } catch (queueError) {
    logger.error('Failed to queue offline operation', queueError);

    // Return error response
    return res.status(503).json({
      success: false,
      error: 'Network error and unable to queue operation',
      message: error.message,
    });
  }
};

/**
 * Check if error is network/offline related
 */
const isOfflineError = (error) => {
  if (!error) return false;

  const networkErrors = [
    'ECONNREFUSED',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ECONNRESET',
    'ETIMEDOUT',
    'Network error',
    'Network request failed',
    'No internet connection',
    'timeout',
    'OFFLINE',
  ];

  const errorMessage = (error.message || '').toLowerCase();
  const errorCode = (error.code || '').toUpperCase();
  const errorName = (error.name || '').toLowerCase();

  return networkErrors.some(
    ne =>
      errorMessage.includes(ne.toLowerCase()) ||
      errorCode.includes(ne) ||
      errorName.includes(ne.toLowerCase())
  );
};

/**
 * Require online middleware
 * Rejects requests if offline and operation requires online status
 */
export const requireOnline = (req, res, next) => {
  const isOnline = req.headers['x-is-online'] !== 'false';

  if (!isOnline) {
    return res.status(503).json({
      success: false,
      error: 'Operation requires internet connection',
      retryable: true,
    });
  }

  next();
};

/**
 * Mark device as online/offline
 */
export const setDeviceStatus = (req, res, next) => {
  const isOnline = req.headers['x-is-online'] !== 'false';
  const deviceId = req.headers['x-device-id'];

  if (deviceId && isOnline !== undefined) {
    // Store in request for logging/tracking
    req.deviceStatus = {
      deviceId,
      isOnline,
      timestamp: new Date(),
    };

    logger.debug('Device status', req.deviceStatus);
  }

  next();
};

/**
 * Check if operation is allowed offline
 */
export const checkOfflinePermission = (operationType) => {
  return async (req, res, next) => {
    const config = req.offlineConfig || {};
    const isOnline = req.headers['x-is-online'] !== 'false';

    // If online, always allow
    if (isOnline) {
      return next();
    }

    // Check if operation is allowed offline
    const allowedOffline = {
      sale: config.allow_sales_offline !== false,
      sales: config.allow_sales_offline !== false,
      expense: config.allow_expenses_offline !== false,
      expenses: config.allow_expenses_offline !== false,
      stock_adjustment: config.allow_stock_adjustment_offline === true,
    };

    if (!allowedOffline[operationType]) {
      return res.status(403).json({
        success: false,
        error: `${operationType} operations are not allowed offline`,
        offlineAvailable: false,
      });
    }

    next();
  };
};

/**
 * Add offline capability headers to response
 */
export const offlineCapabilityHeaders = (req, res, next) => {
  const isOnline = req.headers['x-is-online'] !== 'false';
  const deviceId = req.headers['x-device-id'];

  // Add headers to response
  res.set('X-Device-Id', deviceId || 'unknown');
  res.set('X-Online-Status', isOnline ? 'online' : 'offline');
  res.set('X-Sync-Capable', 'true');

  next();
};
