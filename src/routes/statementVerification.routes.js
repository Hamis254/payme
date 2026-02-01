/**
 * ROUTES: STATEMENT VERIFICATION (QR Code Security)
 * Public endpoint for verifying statement authenticity
 * Admin endpoints for fraud monitoring
 */

import express from 'express';
import { authenticateToken, requireRole } from '#middleware/auth.middleware.js';
import {
  verifyStatementHandler,
  getStatementAuditHandler,
  listSuspiciousStatementsHandler,
} from '#controllers/statementVerification.controller.js';

const router = express.Router();

/**
 * PUBLIC ENDPOINT: Verify statement via QR code
 * Bank officers scan the QR and send verification request
 * 
 * POST /api/verify/statement
 * Body: {
 *   "verification_code": "ABC-DEF-GHI",
 *   "provided_fingerprint": "sha256hash..." (optional),
 *   "device_fingerprint": "device123..." (optional)
 * }
 * 
 * Response:
 * - verified: true/false
 * - fraud_detected: true/false
 * - message: "✓ Authentic" or "⚠️ FRAUD ALERT"
 */
router.post('/statement', verifyStatementHandler);

/**
 * ADMIN ONLY: Get full audit log for a verification code
 * 
 * GET /api/verify/audit/:code
 * Requires: Authentication + Admin role
 */
router.get(
  '/audit/:code',
  authenticateToken,
  requireRole(['admin']),
  getStatementAuditHandler
);

/**
 * ADMIN ONLY: List all suspicious/fraudulent statements
 * 
 * GET /api/verify/suspicious
 * Requires: Authentication + Admin role
 * 
 * Returns: All statements where fingerprint failed verification
 */
router.get(
  '/suspicious',
  authenticateToken,
  requireRole(['admin']),
  listSuspiciousStatementsHandler
);

export default router;
