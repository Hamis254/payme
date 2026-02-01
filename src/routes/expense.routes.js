import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
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
 * Record a new expense for a business
 * @required businessId - path parameter
 * @body {
 *   category: string (rent|utilities|salaries|supplies|transportation|marketing|maintenance|insurance|licenses|other|n/a)
 *   description: string - Clear description of the expense
 *   amount: number - Expense amount in KES
 *   paymentMethod: string (cash|mpesa|bank_transfer|cheque)
 *   paymentReference?: string - M-Pesa receipt, cheque number, or bank reference
 *   paymentPhone?: string - Phone number for M-Pesa payments
 *   expenseDate: string - ISO datetime format
 *   paymentDate?: string - ISO datetime format (if different from expenseDate)
 *   note?: string - Additional context (max 500 chars)
 *   receiptUrl?: string - URL to receipt photo/document
 * }
 * @example POST /api/expenses/5/record
 * {
 *   "category": "transportation",
 *   "description": "Fuel for delivery van",
 *   "amount": 2500,
 *   "paymentMethod": "mpesa",
 *   "paymentReference": "RQT123456789",
 *   "expenseDate": "2026-01-28T10:30:00Z",
 *   "note": "Monthly fuel budget for January"
 * }
 * @response 201 {
 *   success: true,
 *   message: "Expense recorded successfully",
 *   expense: {
 *     id: 1,
 *     category: "transportation",
 *     description: "Fuel for delivery van",
 *     amount: 2500,
 *     payment_method: "mpesa",
 *     expense_date: "2026-01-28",
 *     status: "recorded",
 *     created_at: "2026-01-28T10:30:00Z"
 *   }
 * }
 */
router.post('/:businessId/record', authenticateToken, recordExpenseHandler);

/**
 * GET /api/expenses/:businessId/:expenseId
 * Retrieve a specific expense record
 * @param businessId - Business ID
 * @param expenseId - Expense record ID
 * @example GET /api/expenses/5/1
 * @response 200 {
 *   success: true,
 *   expense: {
 *     id: 1,
 *     business_id: 5,
 *     category: "transportation",
 *     description: "Fuel for delivery van",
 *     amount: 2500,
 *     payment_method: "mpesa",
 *     expense_date: "2026-01-28",
 *     status: "recorded",
 *     created_at: "2026-01-28T10:30:00Z"
 *   }
 * }
 */
router.get('/:businessId/:expenseId', authenticateToken, getExpenseHandler);

/**
 * GET /api/expenses/:businessId
 * List expenses with optional filtering
 * @param businessId - Business ID
 * @query {
 *   category?: string - Filter by category
 *   paymentMethod?: string - Filter by payment method
 *   status?: string - Filter by status (recorded|verified|approved|paid|cancelled)
 *   startDate?: string - ISO datetime start filter
 *   endDate?: string - ISO datetime end filter
 *   limit?: number - Results per page (default: 50, max: 500)
 *   offset?: number - Results to skip (default: 0)
 * }
 * @example GET /api/expenses/5?category=transportation&status=paid&limit=20
 * @response 200 {
 *   success: true,
 *   count: 5,
 *   expenses: [
 *     {
 *       id: 1,
 *       category: "transportation",
 *       description: "Fuel for delivery van",
 *       amount: 2500,
 *       payment_method: "mpesa",
 *       expense_date: "2026-01-28",
 *       status: "paid"
 *     }
 *   ]
 * }
 */
router.get('/:businessId', authenticateToken, listExpensesHandler);

/**
 * GET /api/expenses/:businessId/summary
 * Get expense summary statistics
 * @param businessId - Business ID
 * @query {
 *   startDate?: string - ISO datetime (filter by date range)
 *   endDate?: string - ISO datetime
 * }
 * @example GET /api/expenses/5/summary?startDate=2026-01-01T00:00:00Z&endDate=2026-01-31T23:59:59Z
 * @response 200 {
 *   success: true,
 *   summary: {
 *     total_count: 42,
 *     total_amount: 125500,
 *     average_amount: 2988.10,
 *     max_amount: 15000,
 *     min_amount: 500
 *   }
 * }
 */
router.get('/:businessId/summary', authenticateToken, getExpenseSummaryHandler);

/**
 * GET /api/expenses/:businessId/analytics
 * Get expense analytics with various analysis types
 * @param businessId - Business ID
 * @query {
 *   analysisType: string - Required
 *     - summary: Total statistics
 *     - by_category: Breakdown by category with percentages
 *     - by_payment_method: Breakdown by payment method
 *     - monthly_trend: Trend over months for pattern detection
 *     - top_expenses: Top 10 single expenses
 *     - category_breakdown: Detailed category distribution
 *   startDate?: string - ISO datetime (optional filter)
 *   endDate?: string - ISO datetime (optional filter)
 *   limit?: number - For top results (default: 10, max: 100)
 * }
 * @example GET /api/expenses/5/analytics?analysisType=by_category
 * @example GET /api/expenses/5/analytics?analysisType=monthly_trend
 * @example GET /api/expenses/5/analytics?analysisType=top_expenses&limit=5
 * @response 200 {
 *   success: true,
 *   analysisType: "by_category",
 *   data: {
 *     by_category: [
 *       {
 *         category: "salaries",
 *         count: 12,
 *         total_amount: 75000,
 *         percentage: 59.7,
 *         average_amount: 6250
 *       },
 *       {
 *         category: "transportation",
 *         count: 8,
 *         total_amount: 35000,
 *         percentage: 27.8,
 *         average_amount: 4375
 *       }
 *     ]
 *   }
 * }
 */
router.get('/:businessId/analytics', authenticateToken, getExpenseAnalyticsHandler);

/**
 * PATCH /api/expenses/:businessId/:expenseId
 * Update an expense record (for corrections or status updates)
 * @param businessId - Business ID
 * @param expenseId - Expense record ID
 * @body {
 *   category?: string - Updated category
 *   description?: string - Updated description
 *   amount?: number - Updated amount in KES
 *   paymentMethod?: string - Updated payment method
 *   status?: string - Updated status (recorded|verified|approved|paid|cancelled)
 *   note?: string - Updated note
 * }
 * @example PATCH /api/expenses/5/1
 * {
 *   "status": "paid",
 *   "note": "Verified and processed"
 * }
 * @response 200 {
 *   success: true,
 *   message: "Expense updated successfully",
 *   expense: {
 *     id: 1,
 *     category: "transportation",
 *     description: "Fuel for delivery van",
 *     amount: 2500,
 *     status: "paid",
 *     updated_at: "2026-01-28T15:00:00Z"
 *   }
 * }
 */
router.patch('/:businessId/:expenseId', authenticateToken, updateExpenseHandler);

/**
 * DELETE /api/expenses/:businessId/:expenseId
 * Delete an expense record
 * @param businessId - Business ID
 * @param expenseId - Expense record ID
 * @example DELETE /api/expenses/5/1
 * @response 200 {
 *   success: true,
 *   message: "Expense deleted successfully",
 *   expense: {
 *     id: 1,
 *     category: "transportation",
 *     amount: 2500,
 *     deleted_at: "2026-01-28T15:00:00Z"
 *   }
 * }
 */
router.delete('/:businessId/:expenseId', authenticateToken, deleteExpenseHandler);

export default router;
