// audit.routes.js
import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
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
router.get('/:businessId', getAuditLogsHandler);

/**
 * GET /api/audit/:businessId/summary
 * Get audit summary for dashboard
 */
router.get('/:businessId/summary', getAuditSummaryHandler);

/**
 * GET /api/audit/:businessId/entity/:entityType/:entityId
 * Get audit logs for a specific entity
 */
router.get('/:businessId/entity/:entityType/:entityId', getEntityAuditLogsHandler);

/**
 * GET /api/audit/:businessId/user/:userId
 * Get audit logs for a specific user
 */
router.get('/:businessId/user/:userId', getUserAuditLogsHandler);

/**
 * POST /api/audit/:businessId/log
 * Manually log an audit event
 */
router.post('/:businessId/log', createAuditLogHandler);

export default router;
