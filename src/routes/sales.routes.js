import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { webhookLimiter } from '#middleware/rateLimiter.middleware.js';
import { validateMpesaWebhook } from '#middleware/webhookSecurity.middleware.js';
import {
  getSaleHandler,
  listSalesHandler,
  payCashHandler,
  payMpesaHandler,
  mpesaCallbackHandler,
  cancelSaleHandler,
} from '#controllers/sales.controller.js';

const router = express.Router();

/**
 * NOTE: POST / (createSaleHandler) has been retired.
 * All sale creation goes through POST /api/payme/
 *
 * This router handles:
 * - M-Pesa callback (public)
 * - Cash confirmation (auth)
 * - M-Pesa STK initiation (auth)
 * - Sale queries (auth)
 * - Sale cancellation (auth)
 */

// ─────────────────────────────────────────────
// PUBLIC — M-Pesa callback (no auth, rate limited + IP validated)
// ─────────────────────────────────────────────
router.post(
  '/mpesa/callback',
  webhookLimiter,
  validateMpesaWebhook(),
  mpesaCallbackHandler
);

// ─────────────────────────────────────────────
// AUTHENTICATED routes
// ─────────────────────────────────────────────
router.use(authenticateToken);

// List all sales for a business
router.get('/business/:businessId', listSalesHandler);

// Get single sale with items + payment record
router.get('/:id', getSaleHandler);

// Confirm cash payment for a pending sale
router.post('/:id/pay/cash', payCashHandler);

// Initiate M-Pesa STK push for a pending sale
router.post('/:id/pay/mpesa', payMpesaHandler);

// Cancel a pending sale (refunds token)
router.post('/:id/cancel', cancelSaleHandler);

export default router;
