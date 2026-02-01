import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { webhookLimiter } from '#middleware/rateLimiter.middleware.js';
import {
  getWalletHandler,
  getBalanceHandler,
  initiateTokenPurchaseHandler,
  processCallbackHandler,
  getTransactionsHandler,
  getPurchaseHistoryHandler,
  addTokensHandler,
} from '#controllers/myWallet.controller.js';

const router = express.Router();

/**
 * GET /api/my-wallet/:businessId
 * Get or create wallet for business
 * Authentication: Required
 */
router.get('/:businessId', authenticateToken, getWalletHandler);

/**
 * GET /api/my-wallet/:businessId/balance
 * Get current wallet balance
 * Returns: { balance, reserved_tokens, available_tokens, currency }
 * Authentication: Required
 */
router.get('/:businessId/balance', authenticateToken, getBalanceHandler);

/**
 * POST /api/my-wallet/:businessId/purchase-tokens
 * Initiate token purchase via M-Pesa
 * Body: {
 *   amount: number,
 *   payment_method: 'mpesa',
 *   phone?: string (optional, customer phone)
 * }
 * Returns: { CheckoutRequestID, MerchantRequestID }
 * Authentication: Required
 */
router.post(
  '/:businessId/purchase-tokens',
  authenticateToken,
  initiateTokenPurchaseHandler
);

/**
 * POST /api/my-wallet/callback
 * Handle M-Pesa callback for token purchases
 * Called by M-Pesa API when payment completes
 * Rate limited to prevent abuse
 */
router.post('/callback', webhookLimiter, processCallbackHandler);

/**
 * GET /api/my-wallet/:businessId/transactions
 * Get wallet transaction history
 * Query: { limit?: number, offset?: number }
 * Returns: Array of transactions with dates and amounts
 * Authentication: Required
 */
router.get(
  '/:businessId/transactions',
  authenticateToken,
  getTransactionsHandler
);

/**
 * GET /api/my-wallet/:businessId/purchase-history
 * Get token purchase history
 * Query: { limit?: number, offset?: number }
 * Returns: Array of token purchases with amounts and dates
 * Authentication: Required
 */
router.get(
  '/:businessId/purchase-history',
  authenticateToken,
  getPurchaseHistoryHandler
);

/**
 * POST /api/my-wallet/:businessId/add-tokens
 * Manually add tokens to wallet (admin only)
 * Body: { amount, reason }
 * Returns: { balance, tokens_added }
 * Authentication: Required (Admin)
 */
router.post(
  '/:businessId/add-tokens',
  authenticateToken,
  addTokensHandler
);

export default router;