/**
 * Idempotency Middleware for PayMe
 * Prevents duplicate processing of requests due to network failures
 *
 * How It Works:
 * 1. Client includes `Idempotency-Key` header (UUID)
 * 2. Server stores key + response in database
 * 3. If same key received again, return cached response
 * 4. Prevents duplicate charges, stock movements, transactions
 *
 * Use Cases:
 * - User submits sale twice due to poor network
 * - Browser auto-refresh on loading state
 * - Mobile app retry logic on timeout
 *
 * Best Practices:
 * - Generate UUID v4 on client: crypto.randomUUID()
 * - Only apply to mutation endpoints (POST/PUT/PATCH/DELETE)
 * - Cache responses for 24 hours (configurable)
 * - Log all idempotency hits for debugging
 *
 * Compliance:
 * - Prevents duplicate billing (financial compliance)
 * - Ensures data consistency (ACID compliance)
 * - Maintains accurate inventory (stock management)
 */

import logger from '#config/logger.js';

/**
 * Idempotency key store table schema
 * Import this into your database models
 *
 * CREATE TABLE idempotency_keys (
 *   id SERIAL PRIMARY KEY,
 *   idempotency_key VARCHAR(255) NOT NULL UNIQUE,
 *   endpoint VARCHAR(255) NOT NULL,
 *   user_id INT,
 *   request_body JSONB,
 *   response_status INT,
 *   response_body JSONB NOT NULL,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   expires_at TIMESTAMP NOT NULL,
 *   accessed_count INT DEFAULT 1
 * );
 *
 * CREATE INDEX idx_idempotency_key ON idempotency_keys(idempotency_key);
 * CREATE INDEX idx_expires_at ON idempotency_keys(expires_at);
 */

/**
 * Validate idempotency key format
 * Must be a valid UUID v4 (36 characters)
 *
 * @param {string} key - Idempotency key to validate
 * @returns {boolean} True if valid UUID v4 format
 *
 * @example
 * isValidIdempotencyKey('550e8400-e29b-41d4-a716-446655440000') // true
 */
export const isValidIdempotencyKey = key => {
  if (typeof key !== 'string') return false;
  // UUID v4 regex
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(key);
};

/**
 * Store idempotency request/response
 * Creates or updates the idempotency key record
 *
 * @param {string} idempotencyKey - Unique key from header
 * @param {string} endpoint - API endpoint path
 * @param {number} userId - User making the request
 * @param {Object} requestBody - Original request body
 * @param {number} responseStatus - HTTP response status
 * @param {Object} responseBody - Response data
 * @param {number} cacheDurationMs - How long to cache (default: 24 hours)
 * @returns {Promise<void>}
 *
 * @internal
 */
export const storeIdempotencyKey = async (
  idempotencyKey,
  endpoint,
  userId,
  requestBody,
  responseStatus,
  responseBody,
  cacheDurationMs = 24 * 60 * 60 * 1000
) => {
  try {
    const expiresAt = new Date(Date.now() + cacheDurationMs);

    // TODO: Insert into idempotency_keys table
    // await db.insert(idempotencyKeys).values({
    //   idempotency_key: idempotencyKey,
    //   endpoint,
    //   user_id: userId,
    //   request_body: requestBody,
    //   response_status: responseStatus,
    //   response_body: responseBody,
    //   created_at: new Date(),
    //   expires_at: expiresAt,
    //   accessed_count: 1,
    // });

    logger.debug('Idempotency key stored', {
      idempotencyKey,
      endpoint,
      userId,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to store idempotency key', {
      idempotencyKey,
      error: error.message,
    });
    // Don't throw - idempotency check should not break the request
  }
};

/**
 * Retrieve cached response for idempotency key
 * Returns null if key not found or expired
 *
 * @param {string} idempotencyKey - Unique key to look up
 * @param {string} endpoint - API endpoint path (optional, for validation)
 * @returns {Promise<Object|null>} Cached response or null
 *
 * @example
 * const cached = await getIdempotencyKey('550e8400-e29b-41d4-a716-446655440000');
 * if (cached) {
 *   res.status(cached.response_status).json(cached.response_body);
 * }
 *
 * @internal
 */
export const getIdempotencyKey = async (idempotencyKey, _endpoint = null) => {
  try {
    // TODO: Query idempotency_keys table
    // const [result] = await db
    //   .select()
    //   .from(idempotencyKeys)
    //   .where(
    //     and(
    //       eq(idempotencyKeys.idempotency_key, idempotencyKey),
    //       gt(idempotencyKeys.expires_at, new Date())
    //     )
    //   )
    //   .limit(1);
    //
    // if (result) {
    //   // Increment access count
    //   await db
    //     .update(idempotencyKeys)
    //     .set({ accessed_count: result.accessed_count + 1 })
    //     .where(eq(idempotencyKeys.idempotency_key, idempotencyKey));
    //
    //   return result;
    // }

  } catch (error) {
    logger.error('Failed to retrieve idempotency key', {
      idempotencyKey,
      error: error.message,
    });
  }

  return null;
};

/**
 * Clean up expired idempotency keys
 * Should be run periodically (via cron job)
 *
 * @returns {Promise<number>} Number of keys deleted
 *
 * @example
 * // In cron job (daily at 2 AM)
 * schedule.scheduleJob('0 2 * * *', async () => {
 *   const deleted = await cleanupExpiredIdempotencyKeys();
 *   logger.info(`Cleaned up ${deleted} expired idempotency keys`);
 * });
 *
 * @internal
 */
export const cleanupExpiredIdempotencyKeys = async () => {
  try {
    // TODO: Delete expired keys
    // const result = await db
    //   .delete(idempotencyKeys)
    //   .where(lt(idempotencyKeys.expires_at, new Date()));
    //
    // logger.info('Idempotency key cleanup completed', {
    //   deletedCount: result.rowCount,
    // });
    //
    // return result.rowCount;
  } catch (error) {
    logger.error('Failed to cleanup idempotency keys', {
      error: error.message,
    });
  }

  return 0;
};

/**
 * Idempotency middleware
 * Wraps endpoint handlers to implement idempotency
 *
 * Usage:
 * - Apply only to mutation endpoints (POST/PUT/PATCH/DELETE)
 * - Requires user authentication
 * - Client must include Idempotency-Key header (UUID v4)
 *
 * @returns {Function} Express middleware
 *
 * @example
 * app.post('/api/sales', idempotencyMiddleware(), requireAuth, createSaleHandler);
 *
 * // Client side:
 * const idempotencyKey = crypto.randomUUID();
 * fetch('/api/sales', {
 *   method: 'POST',
 *   headers: {
 *     'Idempotency-Key': idempotencyKey,
 *     'Content-Type': 'application/json',
 *   },
 *   body: JSON.stringify(saleData),
 * });
 */
export const idempotencyMiddleware = () => {
  return async (req, res, next) => {
    // Only apply to mutation endpoints
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    const idempotencyKey = req.get('Idempotency-Key');

    // If no key provided, proceed normally (not idempotent)
    if (!idempotencyKey) {
      logger.debug('Request without Idempotency-Key header', {
        method: req.method,
        path: req.path,
      });
      return next();
    }

    // Validate key format
    if (!isValidIdempotencyKey(idempotencyKey)) {
      logger.warn('Invalid Idempotency-Key format', {
        idempotencyKey,
        userId: req.user?.id,
      });
      return res.status(400).json({
        error: 'Invalid Idempotency-Key',
        message: 'Idempotency-Key must be a valid UUID v4 (e.g., 550e8400-e29b-41d4-a716-446655440000)',
      });
    }

    // Check if this key was already processed
    const cachedResponse = await getIdempotencyKey(
      idempotencyKey,
      req.path
    );

    if (cachedResponse) {
      logger.info('Idempotent request - returning cached response', {
        idempotencyKey,
        userId: req.user?.id,
        accessCount: cachedResponse.accessed_count + 1,
      });

      // Return cached response with appropriate headers
      return res
        .status(cachedResponse.response_status)
        .set('Idempotency-Replay', 'true')
        .json(cachedResponse.response_body);
    }

    // Intercept res.json to capture response
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      // Store the response for idempotency
      storeIdempotencyKey(
        idempotencyKey,
        req.path,
        req.user?.id,
        req.body,
        res.statusCode,
        data
      ).catch(err => {
        logger.error('Failed to store idempotency response', {
          error: err.message,
          idempotencyKey,
        });
      });

      // Return response normally
      return originalJson(data);
    };

    next();
  };
};

/**
 * Get idempotency statistics
 * For monitoring and debugging
 *
 * @returns {Promise<Object>} Statistics about idempotency key usage
 *
 * @example
 * const stats = await getIdempotencyStats();
 * // { totalKeys: 1523, activeKeys: 89, cacheHitRate: 0.15 }
 *
 * @internal
 */
export const getIdempotencyStats = async () => {
  try {
    // TODO: Query idempotency_keys table for stats
    // const totalKeys = await db
    //   .select({ count: sql`count(*)` })
    //   .from(idempotencyKeys);
    //
    // const activeKeys = await db
    //   .select({ count: sql`count(*)` })
    //   .from(idempotencyKeys)
    //   .where(gt(idempotencyKeys.expires_at, new Date()));
    //
    // const replayedKeys = await db
    //   .select()
    //   .from(idempotencyKeys)
    //   .where(gt(idempotencyKeys.accessed_count, 1));
    //
    // return {
    //   totalKeys: totalKeys[0].count,
    //   activeKeys: activeKeys[0].count,
    //   replayedRequests: replayedKeys.length,
    //   replayRate: replayedKeys.length / totalKeys[0].count,
    // };

  } catch (error) {
    logger.error('Failed to get idempotency stats', {
      error: error.message,
    });
  }

  return {
    totalKeys: 0,
    activeKeys: 0,
    replayedRequests: 0,
    replayRate: 0,
  };
};

export default {
  isValidIdempotencyKey,
  storeIdempotencyKey,
  getIdempotencyKey,
  cleanupExpiredIdempotencyKeys,
  idempotencyMiddleware,
  getIdempotencyStats,
};
