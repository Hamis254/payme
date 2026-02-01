/**
 * Payment Configuration Routes
 * Handles business payment method setup (paybill or till)
 * Protected routes - require authentication
 */

import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  setupPaymentMethod,
  getBusinessPaymentConfig,
  updatePaymentMethod,
  togglePaymentConfig,
  verifyPaymentConfigHandler,
} from '#controllers/paymentConfig.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * POST /api/payment-config/setup
 * Business setup payment method after signup
 * Body: {
 *   businessId: number,
 *   payment_method: 'till' | 'paybill',
 *   shortcode: string,
 *   passkey: string,
 *   account_reference: string,
 *   account_name?: string
 * }
 */
router.post('/setup', setupPaymentMethod);

/**
 * GET /api/payment-config/:businessId
 * Get current payment configuration for a business
 * Response: { config }
 */
router.get('/:businessId', getBusinessPaymentConfig);

/**
 * PATCH /api/payment-config/:configId
 * Update payment configuration (passkey, account reference, account name, or toggle)
 * Body: { passkey?, account_reference?, account_name?, is_active? }
 */
router.patch('/:configId', updatePaymentMethod);

/**
 * POST /api/payment-config/:configId/toggle
 * Enable/disable payment configuration
 * Body: { is_active: boolean }
 */
router.post('/:configId/toggle', togglePaymentConfig);

/**
 * POST /api/payment-config/:configId/verify
 * Verify payment configuration credentials with M-Pesa
 * Tests credentials without creating actual transaction
 */
router.post('/:configId/verify', verifyPaymentConfigHandler);

export default router;
