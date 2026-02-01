import logger from '#config/logger.js';

/**
 * Global Error Handler Middleware
 * Catches all unhandled errors and formats responses
 *
 * Must be registered LAST in app.js
 * app.use(globalErrorHandler);
 */

// Custom error classes for better error handling
export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
  }
}

export class AuthorizationError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = 403;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class ConflictError extends Error {
  constructor(message = 'Resource already exists') {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
  }
}

export class RateLimitError extends Error {
  constructor(message = 'Too many requests') {
    super(message);
    this.name = 'RateLimitError';
    this.statusCode = 429;
  }
}

export class DatabaseError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'DatabaseError';
    this.statusCode = 500;
    this.originalError = originalError;
  }
}

export class ExternalServiceError extends Error {
  constructor(
    message = 'External service error',
    serviceName = 'Unknown',
    originalError = null
  ) {
    super(message);
    this.name = 'ExternalServiceError';
    this.statusCode = 502;
    this.serviceName = serviceName;
    this.originalError = originalError;
  }
}

/**
 * Global error handler middleware
 * Logs errors and returns appropriate HTTP responses
 */
export const globalErrorHandler = (error, req, res, next) => {
  // Don't override headers already sent
  if (res.headersSent) {
    logger.error('Error occurred after headers sent', {
      error: error.message,
      url: req.path,
    });
    return next(error);
  }

  // Extract error details
  const errorId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const statusCode = error.statusCode || error.status || 500;
  const isDevelopment = process.env.NODE_ENV !== 'production';

  // Log error with full context
  const errorLog = {
    errorId,
    errorName: error.name,
    message: error.message,
    statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
  };

  if (isDevelopment) {
    errorLog.stack = error.stack;
    errorLog.body = req.body;
  }

  // Determine log level based on status code
  if (statusCode >= 500) {
    logger.error('Server error', errorLog);
  } else if (statusCode >= 400) {
    logger.warn('Client error', errorLog);
  } else {
    logger.info('Application error', errorLog);
  }

  // Build error response
  const response = {
    error: error.name || 'InternalServerError',
    message: error.message,
    errorId, // For support reference
  };

  // Include additional details for specific error types
  if (error instanceof ValidationError && error.details) {
    response.details = error.details;
  }

  // Include error details in development
  if (isDevelopment) {
    response.stack = error.stack;
    if (error.originalError) {
      response.originalError = {
        name: error.originalError.name,
        message: error.originalError.message,
      };
    }
  }

  // Handle specific error types
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      error: 'ConflictError',
      message: 'Resource already exists',
      errorId,
    });
  }

  if (error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'ServiceUnavailable',
      message: 'Database connection failed',
      errorId,
    });
  }

  if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    return res.status(502).json({
      error: 'ExternalServiceError',
      message: 'External service is unavailable',
      errorId,
    });
  }

  // Return error response
  res.status(statusCode).json(response);
};

/**
 * 404 Not Found middleware
 * Catches all unmatched routes
 */
export const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(
    `Route not found: ${req.method} ${req.path}`
  );
  next(error);
};

export default globalErrorHandler;
