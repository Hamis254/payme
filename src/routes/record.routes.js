/**
 * =============================================================================
 * RECORD ROUTES: API endpoints for financial ledger
 * =============================================================================
 * Handles all record operations with authentication and authorization
 * @module routes/record.routes
 */

import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { revenueGuard } from '#middleware/revenueGuard.middleware.js';
import * as recordController from '#controllers/record.controller.js';

const router = express.Router();

/**
 * MIDDLEWARE: Apply authentication and business ownership check to all routes
 */
router.use(authenticateToken);

/**
 * RECORD CREATION
 * POST /api/records/:business_id/create
 * Creates record (sales, HP, credit, inventory, or expense)
 * Revenue Guard: 1 token deducted per record
 * Google Sheets: Auto-synced
 */
router.post(
  '/:business_id/create',
  revenueGuard,
  recordController.createRecord
);

/**
 * LIST RECORDS
 * GET /api/records/:business_id
 * Query params:
 *   - type: sales, hp, credit, inventory, expense
 *   - payment_method: cash, mpesa
 *   - start_date: YYYY-MM-DD
 *   - end_date: YYYY-MM-DD
 *   - limit: max 500 (default: 100)
 *   - offset: pagination (default: 0)
 */
router.get('/:business_id', recordController.getRecords);

/**
 * FINANCIAL TOTALS
 * GET /api/records/:business_id/totals
 * Query params:
 *   - start_date: YYYY-MM-DD (default: 30 days ago)
 *   - end_date: YYYY-MM-DD (default: today)
 * Returns: aggregated totals (sales, expenses, profit, etc.)
 *
 * NOTE: This and every other literal-path GET route below MUST be declared
 * before the wildcard '/:business_id/:record_id' route further down —
 * otherwise Express matches "totals"/"insights"/"statement-preview" as a
 * record_id instead of routing to the intended handler.
 */
router.get('/:business_id/totals', recordController.getTotals);

/**
 * DASHBOARD INSIGHTS
 * GET /api/records/:business_id/insights
 * Query params:
 *   - period: daily, weekly, monthly (default: daily)
 * Returns: trend data for charts
 */
router.get('/:business_id/insights', recordController.getDashboardInsights);

/**
 * STATEMENT PREVIEW DATA
 * GET /api/records/:business_id/statement-preview
 * Query params:
 *   - start_date: YYYY-MM-DD (required)
 *   - end_date: YYYY-MM-DD (optional, default: today)
 * Returns the same authoritative financial payload used by the PDF statement.
 */
router.get(
  '/:business_id/statement-preview',
  recordController.getStatementFinancialsPreview
);

/**
 * GENERATE STATEMENT
 * POST /api/records/:business_id/generate-statement
 * Body:
 *   - start_date: YYYY-MM-DD (required)
 *   - end_date: YYYY-MM-DD (optional, default: today)
 *   - statement_type: summary, full (default: full)
 * Returns: PDF file
 * Bank-grade: SHA-256 fingerprint, QR verification code
 */
router.post(
  '/:business_id/generate-statement',
  recordController.generateStatement
);

/**
 * GET SINGLE RECORD
 * GET /api/records/:business_id/:record_id
 * Returns record with items
 *
 * IMPORTANT: This wildcard route must stay LAST among the GET routes above,
 * since ':record_id' will otherwise greedily match any literal path segment
 * (e.g. "totals", "insights", "statement-preview") that was declared after it.
 */
router.get('/:business_id/:record_id', recordController.getRecordById);

export default router;