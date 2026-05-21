import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { validateBusinessId } from '#middleware/businessId.middleware.js';
import * as analyticsController from '#controllers/analytics.controller.js';

const router = express.Router();

// All analytics routes require authentication
router.use(authenticateToken);

/**
 * GET /api/analytics/:businessId/dashboard
 * Get comprehensive dashboard data (revenue, profit, top products, etc)
 * Query params: period (daily|weekly|monthly|yearly)
 */
router.get(
  '/:businessId/dashboard',
  validateBusinessId('params'),
  analyticsController.getDashboard
);

/**
 * GET /api/analytics/:businessId/summary
 * Quick summary: revenue, profit, margin, transaction count
 * Query params: period (daily|weekly|monthly|yearly)
 */
router.get(
  '/:businessId/summary',
  validateBusinessId('params'),
  analyticsController.getSummary
);

/**
 * GET /api/analytics/:businessId/top-products
 * Get top products by revenue or profit
 * Query params: sortBy (revenue|profit), limit (default 10), period
 */
router.get(
  '/:businessId/top-products',
  validateBusinessId('params'),
  analyticsController.getTopProducts
);

/**
 * GET /api/analytics/:businessId/revenue-breakdown
 * Get revenue split by payment method and customer type
 * Query params: period (daily|weekly|monthly|yearly)
 */
router.get(
  '/:businessId/revenue-breakdown',
  validateBusinessId('params'),
  analyticsController.getRevenueBreakdown
);

/**
 * GET /api/analytics/:businessId/sales-trend
 * Get daily sales trend for last N days
 * Query params: daysBack (default 30), period (daily|weekly)
 */
router.get(
  '/:businessId/sales-trend',
  validateBusinessId('params'),
  analyticsController.getSalesTrend
);

/**
 * GET /api/analytics/:businessId/inventory
 * Get inventory value and statistics
 */
router.get(
  '/:businessId/inventory',
  validateBusinessId('params'),
  analyticsController.getInventory
);

/**
 * GET /api/analytics/:businessId/wallet
 * Get wallet and token statistics
 */
router.get(
  '/:businessId/wallet',
  validateBusinessId('params'),
  analyticsController.getWallet
);

/**
 * GET /api/analytics/:businessId/expenses
 * Get expense statistics
 * Query params: period (daily|weekly|monthly|yearly)
 */
router.get(
  '/:businessId/expenses',
  validateBusinessId('params'),
  analyticsController.getExpenses
);

/**
 * GET /api/analytics/:businessId/customers
 * Get customer statistics
 * Query params: period (daily|weekly|monthly|yearly)
 */
router.get(
  '/:businessId/customers',
  validateBusinessId('params'),
  analyticsController.getCustomers
);

export default router;
