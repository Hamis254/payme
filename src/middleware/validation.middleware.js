import { formatValidationError } from '#utils/format.js';
import logger from '#config/logger.js';

/**
 * Middleware to validate request body, query, or params using Zod schema
 * @param {Object} schema - Zod schema to validate against
 * @param {string} source - Where to get data from ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
export const validateRequest = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const data = req[source];
      const parsed = schema.safeParse(data);

      if (!parsed.success) {
        logger.warn(`Validation failed for ${source}:`, parsed.error);
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: formatValidationError(parsed.error),
        });
      }

      // req.query is a getter-only accessor in Express 5 — it can't be
      // reassigned with `req.query = ...`. Use defineProperty so the
      // validated/coerced data still replaces it. body/params remain
      // plain writable properties, so a direct assignment stays fine there.
      if (source === 'query') {
        Object.defineProperty(req, 'query', {
          value: parsed.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        req[source] = parsed.data;
      }

      next();
    } catch (error) {
      logger.error('Validation middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Error during request validation',
      });
    }
  };
};