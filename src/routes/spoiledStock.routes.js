/**
 * =============================================================================
 * SPOILED STOCK ROUTES: API endpoints for spoilage management
 * =============================================================================
 * Handles recording spoilage, viewing incidents, and analyzing patterns
 *
 * @module routes/spoiledStock.routes
 */

import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { revenueGuard } from '#middleware/revenueGuard.middleware.js';
import {
  recordSpoilageHandler,
  getSpoilageHandler,
  listSpoilageHandler,
  getSpoilageSummaryHandler,
  getSpoilageAnalyticsHandler,
  updateSpoilageHandler,
  deleteSpoilageHandler,
} from '#controllers/spoiledStock.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * RECORD SPOILAGE
 * POST /api/spoilage/record
 * Records a new spoilage incident and updates inventory
 * Revenue Guard: 1 token deducted for tracking purposes
 *
 * Request:
 * {
 *   "businessId": 5,
 *   "productId": 12,
 *   "quantity": 5,
 *   "spoilageType": "damage|expiration|storage|handling|theft|other",
 *   "reason": "Dropped during unloading",
 *   "notes": "Additional context...",
 *   "referenceType": "stock_count|delivery_check|manual",
 *   "referenceId": 42
 * }
 */
router.post(
  '/record',
  revenueGuard,
  recordSpoilageHandler
);

/**
 * GET SPOILAGE RECORD
 * GET /api/spoilage/:businessId/:spoilageId
 * Retrieves a specific spoilage record with product details
 *
 * Response:
 * {
 *   "success": true,
 *   "spoilage": {
 *     "id": 1,
 *     "product_id": 12,
 *     "quantity_spoiled": "5.000",
 *     "unit_cost": "2500.00",
 *     "total_loss_value": "12500.00",
 *     "spoilage_type": "damage",
 *     "reason": "Dropped during unloading",
 *     "created_at": "2026-01-28T10:30:00Z",
 *     "product": {
 *       "id": 12,
 *       "name": "Cooking Oil 5L"
 *     }
 *   }
 * }
 */
router.get('/:businessId/:spoilageId', getSpoilageHandler);

/**
 * LIST SPOILAGE RECORDS
 * GET /api/spoilage/:businessId
 * Lists spoilage records for a business with optional filters
 *
 * Query Parameters:
 * - productId: Filter by product ID
 * - spoilageType: Filter by type (damage, expiration, storage, handling, theft, other)
 * - startDate: Filter from date (ISO 8601)
 * - endDate: Filter to date (ISO 8601)
 * - limit: Number of records (default 50, max 100)
 * - offset: Pagination offset (default 0)
 *
 * Example: GET /api/spoilage/5?spoilageType=damage&limit=20&offset=0
 *
 * Response:
 * {
 *   "success": true,
 *   "count": 3,
 *   "offset": 0,
 *   "limit": 50,
 *   "records": [...]
 * }
 */
router.get('/:businessId', listSpoilageHandler);

/**
 * GET SPOILAGE SUMMARY
 * GET /api/spoilage/:businessId/summary
 * Returns total spoilage statistics for business
 *
 * Response:
 * {
 *   "success": true,
 *   "summary": {
 *     "total_incidents": 15,
 *     "total_quantity": "125.500",
 *     "total_loss_value": "250000.00"
 *   }
 * }
 */
router.get('/:businessId/summary', getSpoilageSummaryHandler);

/**
 * GET SPOILAGE ANALYTICS
 * GET /api/spoilage/:businessId/analytics
 * Provides detailed analysis for pattern identification
 *
 * Query Parameters:
 * - analysisType: Type of analysis to perform
 *   * summary: Total statistics
 *   * by_type: Breakdown by spoilage type
 *   * monthly_trend: Monthly spoilage trends
 *   * top_spoiled: Most frequently spoiled products
 *   * highest_loss: Products with highest financial loss
 *   * spoilage_rate: Spoilage rate percentage (quantity spoiled / total available)
 * - limit: Number of items (default 10, max 100)
 *
 * Example: GET /api/spoilage/5/analytics?analysisType=highest_loss&limit=10
 *
 * Response (highest_loss):
 * {
 *   "success": true,
 *   "analysis_type": "highest_loss",
 *   "analytics": {
 *     "highest_loss": [
 *       {
 *         "id": 12,
 *         "name": "Cooking Oil 5L",
 *         "incident_count": 5,
 *         "total_quantity": "25.000",
 *         "total_loss_value": "50000.00"
 *       },
 *       ...
 *     ]
 *   }
 * }
 */
router.get('/:businessId/analytics', getSpoilageAnalyticsHandler);

/**
 * UPDATE SPOILAGE RECORD
 * PATCH /api/spoilage/:businessId/:spoilageId
 * Updates a spoilage record (for corrections)
 *
 * Request:
 * {
 *   "spoilageType": "storage",
 *   "reason": "Updated reason...",
 *   "notes": "Additional notes..."
 * }
 */
router.patch('/:businessId/:spoilageId', updateSpoilageHandler);

/**
 * DELETE SPOILAGE RECORD
 * DELETE /api/spoilage/:businessId/:spoilageId
 * Deletes a spoilage record and restores the stock quantity
 * (Useful if spoilage was recorded by mistake)
 */
router.delete('/:businessId/:spoilageId', deleteSpoilageHandler);

export default router;
