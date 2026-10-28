import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';

/**
 * Middleware to extract and validate business ID from request
 * Ensures user owns the business before proceeding
 */
export const validateBusinessId = (source = 'params', key = 'businessId') => {
  return async (req, res, next) => {
    try {
      const businessId = req[source]?.[key];

      if (!businessId) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Business ID is required',
        });
      }

      const isPositiveInteger =
        (typeof businessId === 'number' &&
          Number.isSafeInteger(businessId) &&
          businessId > 0) ||
        (typeof businessId === 'string' &&
          /^\d+$/.test(businessId) &&
          Number.isSafeInteger(Number(businessId)) &&
          Number(businessId) > 0);

      if (!isPositiveInteger) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Business ID must be a positive integer',
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

      // A branch can't transact until its main owner's code is entered
      if (business.branch_status === 'pending_approval') {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Branch is awaiting approval',
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
