import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { idempotencyMiddleware } from '#middleware/idempotency.middleware.js';
import { requirePaymentConfig } from '#middleware/requirePaymentConfig.middleware.js';
import { offlineQueueMiddleware } from '#middleware/offline.middleware.js';
import {
  previewCart,
  processPayMe,
  getSalesItemsHistory,
  getSalesHistory,
  getSaleDetails,
  getDailySalesLedgerHandler,
  getMpesaAttemptStatus,
} from '#controllers/payme.controller.js';

const router = express.Router();

// All PayMe routes require authentication
router.use(authenticateToken);

/**
 * POST /api/payme/preview
 * Preview cart: validate items and return totals before payment.
 * No sale is created — safe to call multiple times.
 */
router.post('/preview', previewCart);

/**
 * POST /api/payme/
 * THE sole entry point for all sale creation.
 * Handles: cash, M-Pesa, credit, hire purchase.
 *
 * Middleware chain:
 *   idempotencyMiddleware — prevents double-tap/double-submit (requires Idempotency-Key header)
 *   requirePaymentConfig  — blocks M-Pesa sales if merchant has no active payment config
 */

router.post(
  '/',
  offlineQueueMiddleware('sale'),
  idempotencyMiddleware({ requireIdempotencyKey: true }),
  requirePaymentConfig,
  processPayMe
);

/**
 * GET /api/payme/mpesa/attempts/:id
 * Poll an STK push. An M-Pesa checkout returns 202 with an attempt_id and
 * NO sale — the sale only exists once the callback confirms payment, and
 * this is how the client finds out. Declared before /sales/:id so the two
 * path patterns can't shadow each other.
 */
router.get('/mpesa/attempts/:id', getMpesaAttemptStatus);

/**
 * GET /api/payme/sales/business/:businessId/items
 * Sale line items for a business, one row per product per sale.
 * Query: limit, offset (optional)
 */
router.get('/sales/business/:businessId/items', getSalesItemsHistory);

/**
 * GET /api/payme/sales/business/:businessId
 * Sales history for a business.
 * Query: limit (optional)
 */
router.get('/sales/business/:businessId', getSalesHistory);

/**
 * GET /api/payme/sales/business/:businessId/daily-ledger
 * Daily sales ledger for a business over a date range.
 * Query: startDate, endDate (optional)
 */
router.get('/sales/business/:businessId/daily-ledger', getDailySalesLedgerHandler);

/**
 * GET /api/payme/sales/:id
 * Single sale details with items.
 */
router.get('/sales/:id', getSaleDetails);

export default router;