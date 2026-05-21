import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { validateBusinessId } from '#middleware/businessId.middleware.js';
import {
  getAuditLogsHandler,
  getEntityAuditLogsHandler,
  getUserAuditLogsHandler,
  getAuditSummaryHandler,
  createAuditLogHandler,
} from '#controllers/audit.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/audit/:businessId
 * Get audit logs for a business
 */
router.get('/:businessId', validateBusinessId('params'), getAuditLogsHandler);

/**
 * GET /api/audit/:businessId/summary
 * Get audit summary for dashboard
 */
router.get(
  '/:businessId/summary',
  validateBusinessId('params'),
  getAuditSummaryHandler
);

/**
 * GET /api/audit/:businessId/entity/:entityType/:entityId
 * Get audit logs for a specific entity
 */
router.get(
  '/:businessId/entity/:entityType/:entityId',
  validateBusinessId('params'),
  getEntityAuditLogsHandler
);

/**
 * GET /api/audit/:businessId/user/:userId
 * Get audit logs for a specific user
 */
router.get(
  '/:businessId/user/:userId',
  validateBusinessId('params'),
  getUserAuditLogsHandler
);

/**
 * POST /api/audit/:businessId/log
 * Manually log an audit event
 */
router.post(
  '/:businessId/log',
  validateBusinessId('params'),
  createAuditLogHandler
);

export default router;
