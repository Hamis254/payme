import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { webhookLimiter } from '#middleware/rateLimiter.middleware.js';
import { validateMpesaWebhook } from '#middleware/webhookSecurity.middleware.js';
import {
  getSaleHandler,
  listSalesHandler,
  mpesaCallbackHandler,
  cancelSaleHandler,
} from '#controllers/sales.controller.js';

const router = express.Router();

/**
 * NOTE: POST / (createSaleHandler) has been retired.
 * All sale creation goes through POST /api/payme/
 *
 * POST /:id/pay/cash and POST /:id/pay/mpesa have now been retired too.
 * They were the second half of a two-step "create a sale, then pay it"
 * flow whose first step (createSaleHandler) was removed in the same commit
 * that wrote the note above — leaving two handlers that could only act on
 * pending sales this router no longer had any way to create. Neither was
 * ever called: no Flutter call sites, no internal callers, an empty
 * offline queue, an empty payments table, and not one sale in the database
 * carrying the amount_paid or stk_request_id they would have written.
 *
 * payCashHandler additionally set status='completed'/payment_status='success'
 * without checking payment_mode, so calling it on a credit or hire purchase
 * sale would have reported an outstanding debt as settled while the credit
 * account still showed the balance owing.
 *
 * This router handles:
 * - M-Pesa callback (public)
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

// Cancel a pending sale (refunds token)
router.post('/:id/cancel', cancelSaleHandler);

export default router;
