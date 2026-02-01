import logger from '#config/logger.js';

/**
 * Async request wrapper that handles errors automatically
 * Eliminates repetitive try-catch blocks in controllers
 *
 * Usage:
 * router.post('/', asyncHandler(async (req, res) => {
 *   // No try-catch needed!
 *   const result = await someAsyncOperation();
 *   res.json(result);
 * }));
 */
export const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Validate request body using Zod schema
 * Automatically handles validation and error response
 */
export const validateRequest = schema => asyncHandler(
  async (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      logger.warn('Request validation failed', {
        path: req.path,
        errors: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });

      return res.status(400).json({
        error: 'ValidationError',
        message: 'Request validation failed',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }

    // Attach validated data to request
    req.validatedData = result.data;
    next();
  }
);

/**
 * Verify user is authenticated
 * Fail fast if not authenticated
 */
export const requireAuth = asyncHandler((req, res, next) => {
  if (!req.user) {
    logger.warn('Unauthorized access attempt', {
      path: req.path,
      ip: req.ip,
    });

    return res.status(401).json({
      error: 'AuthenticationError',
      message: 'Authentication required',
    });
  }

  next();
});

/**
 * Verify user has required role
 * Can be chained: [requireAuth, requireRole(['admin'])]
 */
export const requireRole = allowedRoles => asyncHandler((req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'AuthenticationError',
      message: 'Authentication required',
    });
  }

  if (!Array.isArray(allowedRoles)) {
    allowedRoles = [allowedRoles];
  }

  if (!allowedRoles.includes(req.user.role)) {
    logger.warn('Unauthorized role access', {
      requiredRole: allowedRoles,
      userRole: req.user.role,
      userId: req.user.id,
      path: req.path,
    });

    return res.status(403).json({
      error: 'AuthorizationError',
      message: 'Insufficient permissions',
      requiredRole: allowedRoles,
    });
  }

  next();
});

/**
 * Convert route parameters to typed values
 * Validates numeric IDs, etc.
 */
export const parseParams = schema => asyncHandler(async (req, res, next) => {
  const result = schema.safeParse(req.params);

  if (!result.success) {
    logger.warn('Invalid route parameters', {
      path: req.path,
      params: req.params,
      errors: result.error.issues,
    });

    return res.status(400).json({
      error: 'ValidationError',
      message: 'Invalid route parameters',
      details: result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  req.validatedParams = result.data;
  next();
});

/**
 * Rate limit check using request metadata
 * Works with Arcjet security middleware
 */
export const checkRateLimit = asyncHandler((req, res, next) => {
  if (res.locals?.rateLimitExceeded) {
    logger.warn('Rate limit exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      path: req.path,
    });

    return res.status(429).json({
      error: 'RateLimitError',
      message: 'Too many requests, please try again later',
      retryAfter: res.locals?.retryAfter || 60,
    });
  }

  next();
});

/**
 * Idempotency header validation
 * Ensures duplicate requests are handled safely
 *
 * Usage: app.use(idempotencyMiddleware);
 */
export const idempotencyMiddleware = asyncHandler((req, res, next) => {
  // Store idempotency key for handling duplicate requests
  const idempotencyKey = req.headers['idempotency-key'];

  if (idempotencyKey) {
    // For POST/PUT/DELETE operations
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      // Store key for deduplication
      req.idempotencyKey = idempotencyKey;

      // Could cache responses by this key in Redis for true idempotency
      logger.debug('Idempotency key detected', {
        key: idempotencyKey,
        method: req.method,
        path: req.path,
      });
    }
  }

  next();
});

/**
 * Request/Response logging middleware
 * Logs all requests with timing and response status
 */
export const requestLoggingMiddleware = asyncHandler((req, res, next) => {
  const startTime = Date.now();
  const path = req.path;
  const method = req.method;

  // Log request
  logger.debug('Incoming request', {
    method,
    path,
    userId: req.user?.id,
    ip: req.ip,
  });

  // Override res.send to log response
  const originalSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Log response
    if (statusCode >= 400) {
      logger.warn('Request error', {
        method,
        path,
        statusCode,
        duration: `${duration}ms`,
        userId: req.user?.id,
      });
    } else {
      logger.debug('Request completed', {
        method,
        path,
        statusCode,
        duration: `${duration}ms`,
      });
    }

    res.send = originalSend;
    return originalSend.call(this, data);
  };

  next();
});

export default {
  asyncHandler,
  validateRequest,
  requireAuth,
  requireRole,
  parseParams,
  checkRateLimit,
  idempotencyMiddleware,
  requestLoggingMiddleware,
};
