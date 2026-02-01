// reconciliation.routes.js
import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  getConfigHandler,
  updateConfigHandler,
  createCashReconciliationHandler,
  listCashReconciliationsHandler,
  approveCashReconciliationHandler,
  flagCashReconciliationHandler,
  createMpesaReconciliationHandler,
  listMpesaReconciliationsHandler,
  getSummaryHandler,
} from '#controllers/reconciliation.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/reconciliation/:businessId/config
 * Get reconciliation configuration
 */
router.get('/:businessId/config', getConfigHandler);

/**
 * PATCH /api/reconciliation/:businessId/config
 * Update reconciliation configuration
 */
router.patch('/:businessId/config', updateConfigHandler);

/**
 * GET /api/reconciliation/:businessId/summary
 * Get reconciliation summary for dashboard
 */
router.get('/:businessId/summary', getSummaryHandler);

// ============ CASH RECONCILIATION ============

/**
 * POST /api/reconciliation/:businessId/cash
 * Create cash reconciliation
 */
router.post('/:businessId/cash', createCashReconciliationHandler);

/**
 * GET /api/reconciliation/:businessId/cash
 * List cash reconciliations
 */
router.get('/:businessId/cash', listCashReconciliationsHandler);

/**
 * POST /api/reconciliation/:businessId/cash/:id/approve
 * Approve a cash reconciliation
 */
router.post('/:businessId/cash/:id/approve', approveCashReconciliationHandler);

/**
 * POST /api/reconciliation/:businessId/cash/:id/flag
 * Flag a cash reconciliation for investigation
 */
router.post('/:businessId/cash/:id/flag', flagCashReconciliationHandler);

// ============ M-PESA RECONCILIATION ============

/**
 * POST /api/reconciliation/:businessId/mpesa
 * Create M-Pesa reconciliation
 */
router.post('/:businessId/mpesa', createMpesaReconciliationHandler);

/**
 * GET /api/reconciliation/:businessId/mpesa
 * List M-Pesa reconciliations
 */
router.get('/:businessId/mpesa', listMpesaReconciliationsHandler);

export default router;
