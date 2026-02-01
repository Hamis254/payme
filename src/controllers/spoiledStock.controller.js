/**
 * =============================================================================
 * SPOILED STOCK CONTROLLER: HTTP handlers for spoilage management
 * =============================================================================
 * Handles recording spoilage incidents, retrieving records, and generating
 * analytics for pattern analysis
 *
 * @module controllers/spoiledStock.controller
 */

import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import * as spoiledStockService from '#services/spoiledStock.service.js';
import {
  recordSpoilageSchema,
  listSpoilageSchema,
  updateSpoilageSchema,
  getSpoilageAnalyticsSchema,
  deleteSpoilageSchema,
} from '#validations/spoiledStock.validation.js';

/**
 * RECORD SPOILAGE
 * POST /api/spoilage/record
 * Records a spoilage incident and updates inventory
 */
export const recordSpoilageHandler = async (req, res, next) => {
  try {
    const requestId = req.revenueGuard?.request_id;

    // Validate input
    const validationResult = recordSpoilageSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
        request_id: requestId,
      });
    }

    const {
      businessId,
      productId,
      quantity,
      spoilageType,
      reason,
      notes,
      referenceType,
      referenceId,
    } = validationResult.data;

    // Record spoilage (business logic handles stock update)
    const spoilage = await spoiledStockService.recordSpoilage(
      businessId,
      productId,
      quantity,
      spoilageType,
      reason,
      notes,
      req.user?.id,
      referenceType,
      referenceId
    );

    logger.info('Spoilage recorded successfully', {
      business_id: businessId,
      product_id: productId,
      spoilage_id: spoilage.id,
      quantity,
      loss_value: spoilage.total_loss_value,
      request_id: requestId,
    });

    res.status(201).json({
      success: true,
      message: 'Spoilage recorded successfully',
      spoilage: {
        id: spoilage.id,
        product_id: spoilage.product_id,
        quantity_spoiled: spoilage.quantity_spoiled,
        loss_value: spoilage.total_loss_value,
        spoilage_type: spoilage.spoilage_type,
        reason: spoilage.reason,
        created_at: spoilage.created_at,
      },
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Error recording spoilage', {
      error: error.message,
      request_id: req.revenueGuard?.request_id,
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Not found',
        message: error.message,
        request_id: req.revenueGuard?.request_id,
      });
    }

    if (error.message.includes('Cannot spoil')) {
      return res.status(400).json({
        error: 'Insufficient stock',
        message: error.message,
        request_id: req.revenueGuard?.request_id,
      });
    }

    next(error);
  }
};

/**
 * GET SPOILAGE RECORD
 * GET /api/spoilage/:spoilageId
 * Retrieves a specific spoilage record with product details
 */
export const getSpoilageHandler = async (req, res, next) => {
  try {
    const { businessId, spoilageId } = req.params;
    const requestId = req.revenueGuard?.request_id;

    const spoilage = await spoiledStockService.getSpoilageById(
      parseInt(businessId),
      parseInt(spoilageId)
    );

    res.status(200).json({
      success: true,
      spoilage,
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Error retrieving spoilage', { error: error.message });

    if (error.message === 'Spoilage record not found') {
      return res.status(404).json({
        error: 'Not found',
        message: error.message,
        request_id: req.revenueGuard?.request_id,
      });
    }

    next(error);
  }
};

/**
 * LIST SPOILAGE RECORDS
 * GET /api/spoilage
 * Lists spoilage records with optional filters
 *
 * Query params:
 * - productId: Filter by product
 * - spoilageType: Filter by type (expiration, damage, storage, handling, theft, other)
 * - startDate: Filter by start date (ISO 8601)
 * - endDate: Filter by end date (ISO 8601)
 * - limit: Pagination limit (default 50, max 100)
 * - offset: Pagination offset (default 0)
 */
export const listSpoilageHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const requestId = req.revenueGuard?.request_id;

    // Validate query parameters
    const validationResult = listSpoilageSchema.safeParse({
      businessId: parseInt(businessId),
      ...req.query,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(validationResult.error),
        request_id: requestId,
      });
    }

    const { productId, spoilageType, startDate, endDate, limit, offset } =
      validationResult.data;

    // Get spoilage records
    const records = await spoiledStockService.listSpoilageRecords(
      parseInt(businessId),
      {
        productId,
        spoilageType,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        limit,
        offset,
      }
    );

    res.status(200).json({
      success: true,
      count: records.length,
      offset,
      limit,
      records,
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Error listing spoilage records', { error: error.message });
    next(error);
  }
};

/**
 * GET SPOILAGE SUMMARY
 * GET /api/spoilage/:businessId/summary
 * Returns total spoilage statistics
 */
export const getSpoilageSummaryHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const requestId = req.revenueGuard?.request_id;

    const summary = await spoiledStockService.getSpoilageSummary(
      parseInt(businessId)
    );

    res.status(200).json({
      success: true,
      summary,
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Error getting spoilage summary', { error: error.message });
    next(error);
  }
};

/**
 * GET SPOILAGE ANALYTICS
 * GET /api/spoilage/:businessId/analytics
 * Provides detailed analysis for pattern identification
 *
 * Query params:
 * - analysisType: summary, by_type, monthly_trend, top_spoiled, highest_loss, spoilage_rate
 * - limit: Number of items (default 10, max 100)
 */
export const getSpoilageAnalyticsHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const requestId = req.revenueGuard?.request_id;

    // Validate query parameters
    const validationResult = getSpoilageAnalyticsSchema.safeParse({
      businessId: parseInt(businessId),
      ...req.query,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(validationResult.error),
        request_id: requestId,
      });
    }

    const { analysisType, limit } = validationResult.data;
    const biz = parseInt(businessId);

    const analytics = {};

    switch (analysisType) {
      case 'summary':
        analytics.summary = await spoiledStockService.getSpoilageSummary(biz);
        break;

      case 'by_type':
        analytics.by_type = await spoiledStockService.getSpoilageByType(biz);
        break;

      case 'monthly_trend':
        analytics.monthly_trend = await spoiledStockService.getMonthlySpoilageTrend(
          biz
        );
        break;

      case 'top_spoiled':
        analytics.top_spoiled = await spoiledStockService.getTopSpoiledProducts(
          biz,
          limit
        );
        break;

      case 'highest_loss':
        analytics.highest_loss = await spoiledStockService.getHighestLossProducts(
          biz,
          limit
        );
        break;

      case 'spoilage_rate':
        analytics.spoilage_rate =
          await spoiledStockService.getHighestSpoilageRateProducts(biz, limit);
        break;
    }

    res.status(200).json({
      success: true,
      analysis_type: analysisType,
      analytics,
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Error getting spoilage analytics', { error: error.message });
    next(error);
  }
};

/**
 * UPDATE SPOILAGE RECORD
 * PATCH /api/spoilage/:spoilageId
 * Updates a spoilage record
 */
export const updateSpoilageHandler = async (req, res, next) => {
  try {
    const { businessId, spoilageId } = req.params;
    const requestId = req.revenueGuard?.request_id;

    // Validate input
    const validationResult = updateSpoilageSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
        request_id: requestId,
      });
    }

    // Update record
    const updated = await spoiledStockService.updateSpoilageRecord(
      parseInt(businessId),
      parseInt(spoilageId),
      validationResult.data
    );

    logger.info('Spoilage record updated', {
      business_id: businessId,
      spoilage_id: spoilageId,
      request_id: requestId,
    });

    res.status(200).json({
      success: true,
      message: 'Spoilage record updated',
      spoilage: updated,
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Error updating spoilage record', { error: error.message });

    if (error.message === 'Spoilage record not found') {
      return res.status(404).json({
        error: 'Not found',
        message: error.message,
        request_id: req.revenueGuard?.request_id,
      });
    }

    next(error);
  }
};

/**
 * DELETE SPOILAGE RECORD
 * DELETE /api/spoilage/:spoilageId
 * Deletes a spoilage record and restores stock
 */
export const deleteSpoilageHandler = async (req, res, next) => {
  try {
    const { businessId, spoilageId } = req.params;
    const requestId = req.revenueGuard?.request_id;

    // Validate input
    const validationResult = deleteSpoilageSchema.safeParse({
      businessId: parseInt(businessId),
      spoilageId: parseInt(spoilageId),
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
        request_id: requestId,
      });
    }

    // Delete record (service handles stock restoration)
    await spoiledStockService.deleteSpoilageRecord(
      parseInt(businessId),
      parseInt(spoilageId)
    );

    logger.info('Spoilage record deleted', {
      business_id: businessId,
      spoilage_id: spoilageId,
      request_id: requestId,
    });

    res.status(200).json({
      success: true,
      message: 'Spoilage record deleted and stock restored',
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Error deleting spoilage record', { error: error.message });

    if (error.message === 'Spoilage record not found') {
      return res.status(404).json({
        error: 'Not found',
        message: error.message,
        request_id: req.revenueGuard?.request_id,
      });
    }

    next(error);
  }
};
