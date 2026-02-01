import express from 'express';
import { authenticateToken, requireRole } from '#middleware/auth.middleware.js';
import { webhookLimiter } from '#middleware/rateLimiter.middleware.js';
import {
  getWalletBalance,
  initiateTokenPurchaseHandler,
  tokenPurchaseCallbackHandler,
  addTokensManuallyHandler,
  getWalletTransactionsHandler,
  getTokenPurchasesHandler,
  getTokenPackagesHandler,
} from '#controllers/wallet.controller.js';

const router = express.Router();

// ============ PUBLIC ROUTES ============

// M-Pesa callback for token purchases (no auth required)
// Rate limited to prevent abuse
router.post('/callback/token-purchase', webhookLimiter, tokenPurchaseCallbackHandler);

// Get available token packages (no auth required)
router.get('/packages', getTokenPackagesHandler);

// ============ AUTHENTICATED ROUTES ============

router.use(authenticateToken);

// Get wallet balance for a business
router.get('/business/:businessId', getWalletBalance);

// Initiate token purchase via M-Pesa
router.post('/purchase', initiateTokenPurchaseHandler);

// Get wallet transaction history
router.get('/business/:businessId/transactions', getWalletTransactionsHandler);

// Get token purchase history
router.get('/business/:businessId/purchases', getTokenPurchasesHandler);

// ============ ADMIN ONLY ROUTES ============

// Manually add tokens (admin only)
router.post(
  '/admin/add-tokens',
  requireRole(['admin']),
  addTokensManuallyHandler
);

export default router;
