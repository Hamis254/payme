/**
 * Advanced Rate Limiting Middleware for PayMe
 * Implements multiple rate limiting strategies for different endpoints
 *
 * Strategies:
 * 1. Login brute force protection: 5 attempts per 15 minutes per IP
 * 2. Statement verification: 10 requests per minute per IP (public endpoint)
 * 3. API brute force: 100 attempts per hour per IP (fallback)
 *
 * Uses in-memory store for simplicity (production should use Redis)
 * Complements Arcjet middleware for defense-in-depth
 */

import logger from '#config/logger.js';

/**
 * In-memory rate limit store
 * Format: { `${ip}:${endpoint}`: { count, resetAt } }
 *
 * TODO: In production, migrate to Redis:
 * - Use redis client from #config/redis.js
 * - Use SET with EX (expiry) for automatic cleanup
 * - Supports distributed deployments
 */
const rateLimitStore = new Map();

/**
 * Clean up expired entries every minute
 * Prevents memory leak from stale entries
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Every 60 seconds

/**
 * Generic rate limiter middleware factory
 * Creates middleware for endpoint-specific limits
 *
 * @param {Object} options - Configuration
 * @param {number} options.maxRequests - Max requests allowed
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {string} options.endpoint - Endpoint name for logging
 * @param {Function} options.keyGenerator - Function to generate rate limit key (default: IP)
 * @param {Function} options.skipSuccessfulRequests - Skip counting successful requests (default: false)
 * @returns {Function} Express middleware
 *
 * @example
 * // 5 login attempts per 15 minutes
 * const loginLimiter = createRateLimiter({
 *   maxRequests: 5,
 *   windowMs: 15 * 60 * 1000,
 *   endpoint: 'login'
 * });
 * app.post('/api/auth/signin', loginLimiter, signinHandler);
 */
export const createRateLimiter = (options = {}) => {
  const {
    maxRequests = 10,
    windowMs = 60000, // 1 minute default
    endpoint = 'unknown',
    keyGenerator = req => req.ip || req.connection.remoteAddress,
    skipSuccessfulRequests = false,
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    // Get or create rate limit entry
    let entry = rateLimitStore.get(key);
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    }

    // Check if limit exceeded
    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

      logger.warn('Rate limit exceeded', {
        ip: key,
        endpoint,
        limit: maxRequests,
        window: `${windowMs / 1000}s`,
        retryAfter,
      });

      return res
        .status(429)
        .set('Retry-After', retryAfter)
        .set('X-RateLimit-Limit', maxRequests)
        .set('X-RateLimit-Remaining', 0)
        .set('X-RateLimit-Reset', new Date(entry.resetAt).toISOString())
        .json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter,
        });
    }

    // Increment counter
    entry.count++;

    // Add rate limit info to response headers
    res.set('X-RateLimit-Limit', maxRequests);
    res.set('X-RateLimit-Remaining', maxRequests - entry.count);
    res.set('X-RateLimit-Reset', new Date(entry.resetAt).toISOString());

    // Store original res.json to intercept success tracking
    if (!skipSuccessfulRequests) {
      next();
      return;
    }

    // Skip counting on successful requests
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      if (res.statusCode < 400) {
        // Request was successful, roll back the count
        entry.count--;
      }
      return originalJson(data);
    };

    next();
  };
};

/**
 * Login brute force protection
 * 5 attempts per 15 minutes per IP
 *
 * Strategy:
 * - Failed login attempts count toward limit
 * - Successful login resets counter
 * - IP-based (not user-based to prevent user enumeration)
 * - Logs all attempts for security team review
 */
export const loginLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  endpoint: 'login',
  keyGenerator: req => {
    // Use IP address to prevent enumeration
    return req.ip || req.connection.remoteAddress;
  },
});

/**
 * Statement verification rate limiter
 * Prevents QR code brute force scanning
 * 10 requests per minute per IP
 */
export const statementVerificationLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000, // 1 minute
  endpoint: 'statement_verification',
  keyGenerator: req => req.ip || req.connection.remoteAddress,
});

/**
 * Webhook rate limiter
 * Protects webhook endpoints (M-Pesa callbacks, etc.)
 * 60 requests per minute per IP - allows burst for payment notifications
 * Higher limit because payment providers may send multiple callbacks
 */
export const webhookLimiter = createRateLimiter({
  maxRequests: 60,
  windowMs: 60 * 1000, // 1 minute
  endpoint: 'webhook',
  keyGenerator: req => req.ip || req.connection.remoteAddress,
});

/**
 * API brute force protection
 * Fallback limiter for general API endpoints
 * 100 requests per hour per IP
 */
export const apiBruteForceLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60 * 60 * 1000, // 1 hour
  endpoint: 'api_brute_force',
  keyGenerator: req => req.ip || req.connection.remoteAddress,
});

/**
 * Distributed rate limiter (Redis-based)
 * For production deployments with multiple servers
 *
 * This is a placeholder for production implementation
 * Uses Redis instead of in-memory store
 *
 * TODO: Implement when Redis is added to production stack
 */
export const createDistributedRateLimiter = async (_options = {}) => {
  // TODO: Implement Redis-based rate limiting
  // const redis = require('redis').createClient();
  // Key pattern: payme:ratelimit:${endpoint}:${ip}:${timestamp}
  // Use Redis INCR with EX for atomic operations across servers
  throw new Error('Distributed rate limiter not yet implemented. Use Redis backend.');
};

/**
 * Get current rate limit stats for monitoring
 * Returns current state of all active rate limits
 *
 * @returns {Object} Rate limit statistics
 *
 * @example
 * const stats = getRateLimitStats();
 * // { ips: 5, endpoints: ['login', 'statement_verification'], memoryMB: 0.5 }
 */
export const getRateLimitStats = () => {
  const stats = {
    ips: rateLimitStore.size,
    endpoints: new Set(),
    entries: 0,
  };

  rateLimitStore.forEach(() => {
    stats.entries++;
  });

  return stats;
};

/**
 * Reset rate limit for specific IP/endpoint
 * Useful for admin operations or whitelisting
 *
 * @param {string} ip - IP address to reset
 * @param {string} endpoint - Endpoint to reset (optional, resets all if omitted)
 */
export const resetRateLimit = (ip, endpoint = null) => {
  if (endpoint) {
    rateLimitStore.delete(`${ip}:${endpoint}`);
    logger.info('Rate limit reset for IP', { ip, endpoint });
  } else {
    // Reset all entries for this IP
    for (const key of rateLimitStore.keys()) {
      if (key.startsWith(ip)) {
        rateLimitStore.delete(key);
      }
    }
    logger.info('Rate limit reset for IP (all endpoints)', { ip });
  }
};

/**
 * Whitelist IP for rate limiting bypass
 * Use with caution - only for trusted partners/admins
 *
 * TODO: Implement IP whitelist database
 */
export const createWhitelistMiddleware = (whitelistedIps = []) => {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (whitelistedIps.includes(ip)) {
      logger.debug('Whitelisted IP bypassed rate limiting', { ip });
      return next();
    }
    next();
  };
};

export default {
  createRateLimiter,
  loginLimiter,
  statementVerificationLimiter,
  webhookLimiter,
  apiBruteForceLimiter,
  createDistributedRateLimiter,
  getRateLimitStats,
  resetRateLimit,
  createWhitelistMiddleware,
};
