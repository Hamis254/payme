import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';

/**
 * Middleware to extract and validate business ID from request
 * Ensures user owns the business before proceeding
 */
export const validateBusinessId = (source = 'params') => {
  return async (req, res, next) => {
    try {
      const businessId =
        source === 'body'
          ? req.body.businessId
          : source === 'query'
            ? req.query.businessId
            : req.params.businessId;

      if (!businessId) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Business ID is required',
        });
      }

      // Verify user owns this business
      const [business] = await db
        .select()
        .from(businesses)
        .where(
          and(
            eq(businesses.id, businessId),
            eq(businesses.user_id, req.user.id)
          )
        )
        .limit(1);

      if (!business) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Business not found or access denied',
        });
      }

      // Add validated business to request
      req.businessId = businessId;
      req.business = business;

      next();
    } catch (error) {
      logger.error('Business ID validation error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Error validating business ID',
      });
    }
  };
};
