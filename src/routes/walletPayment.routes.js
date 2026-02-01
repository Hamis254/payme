import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  initiateWalletPayment,
  completeWalletPayment,
  getWalletPaymentStatus,
  getWalletBalance,
  getWalletTransactionHistory,
} from '#controllers/walletPayment.controller.js';

const router = express.Router();

/**
 * POST /api/wallet-payment/initiate
 * Initiate wallet payment via M-Pesa STK Push
 * Using paybill 650880 and account 37605544
 * Body: { saleId, phone, amount }
 * Authentication: Required
 */
router.post(
  '/initiate',
  authenticateToken,
  initiateWalletPayment
);

/**
 * POST /api/wallet-payment/complete
 * Complete wallet payment (called via M-Pesa callback)
 * Body: { walletPaymentId, mpesaTransactionId, status }
 * Authentication: Not required (webhook)
 */
router.post(
  '/complete',
  completeWalletPayment
);

/**
 * GET /api/wallet-payment/status/:paymentId
 * Get wallet payment status
 * Response: { walletPayment }
 * Authentication: Required
 */
router.get(
  '/status/:paymentId',
  authenticateToken,
  getWalletPaymentStatus
);

/**
 * GET /api/wallet-payment/balance/:businessId
 * Get wallet balance for business
 * Response: { balanceTokens, balanceKsh }
 * Authentication: Required
 */
router.get(
  '/balance/:businessId',
  authenticateToken,
  getWalletBalance
);

/**
 * GET /api/wallet-payment/transactions/:businessId
 * Get wallet transaction history
 * Response: { transactions: [{ id, changeTokens, type, reference, note, createdAt }] }
 * Authentication: Required
 */
router.get(
  '/transactions/:businessId',
  authenticateToken,
  getWalletTransactionHistory
);

export default router;
