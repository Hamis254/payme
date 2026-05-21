import express from 'express';
import { offlineQueueMiddleware } from '#middleware/offline.middleware.js';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { validateBusinessId } from '#middleware/businessId.middleware.js';
import {
  recordExpenseHandler,
  getExpenseHandler,
  listExpensesHandler,
  getExpenseSummaryHandler,
  getExpenseAnalyticsHandler,
  updateExpenseHandler,
  deleteExpenseHandler,
} from '#controllers/expense.controller.js';

const router = express.Router();

/**
 * POST /api/expenses/:businessId/record
 * Record a new expense for a business.
 * NOTE: revenueGuard intentionally removed — expenses are free operations.
 * Token deduction only applies to sales records.
 */
router.post(
  '/:businessId/record',
  authenticateToken,
  validateBusinessId('params'),
  recordExpenseHandler
);

/**
 * GET /api/expenses/:businessId/:expenseId
 * Retrieve a specific expense record.
 */
router.get(
  '/:businessId/:expenseId',
  authenticateToken,
  validateBusinessId('params'),
  getExpenseHandler
);

/**
 * GET /api/expenses/:businessId
 * List expenses with optional filtering.
 * Query params: category, paymentMethod, status, startDate, endDate, limit, offset
 */
router.get(
  '/:businessId',
  authenticateToken,
  validateBusinessId('params'),
  listExpensesHandler
);

/**
 * GET /api/expenses/:businessId/summary
 * Get expense summary statistics.
 */
router.get(
  '/:businessId/summary',
  authenticateToken,
  validateBusinessId('params'),
  getExpenseSummaryHandler
);

/**
 * GET /api/expenses/:businessId/analytics
 * Get expense analytics (by_category, monthly_trend, top_expenses, etc).
 */
router.get(
  '/:businessId/analytics',
  authenticateToken,
  validateBusinessId('params'),
  getExpenseAnalyticsHandler
);

router.post(
  '/:businessId/record',
  offlineQueueMiddleware('expense'),
  authenticateToken,
  validateBusinessId('params'),
  recordExpenseHandler
);

/**
 * PATCH /api/expenses/:businessId/:expenseId
 * Update an expense record.
 */
router.patch(
  '/:businessId/:expenseId',
  authenticateToken,
  validateBusinessId('params'),
  updateExpenseHandler
);

/**
 * DELETE /api/expenses/:businessId/:expenseId
 * Delete an expense record.
 */
router.delete(
  '/:businessId/:expenseId',
  authenticateToken,
  validateBusinessId('params'),
  deleteExpenseHandler
);

export default router;
