import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { idempotencyMiddleware } from '#middleware/idempotency.middleware.js';
import { requirePaymentConfig } from '#middleware/requirePaymentConfig.middleware.js';
import { offlineQueueMiddleware } from '#middleware/offline.middleware.js';
import {
  previewCart,
  processPayMe,
  getSalesHistory,
  getSaleDetails,
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
  idempotencyMiddleware(),
  requirePaymentConfig,
  processPayMe
);
router.post('/', idempotencyMiddleware(), requirePaymentConfig, processPayMe);

/**
 * GET /api/payme/sales/business/:businessId
 * Sales history for a business.
 * Query: limit (optional)
 */
router.get('/sales/business/:businessId', getSalesHistory);

/**
 * GET /api/payme/sales/:id
 * Single sale details with items.
 */
router.get('/sales/:id', getSaleDetails);

export default router;
