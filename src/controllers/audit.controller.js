// audit.controller.js
import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import { auditLogQuerySchema } from '#validations/audit.validation.js';
import {
  getAuditLogs,
  getEntityAuditLogs,
  getUserAuditLogs,
  getAuditSummary,
  logAuditEvent,
} from '#services/audit.service.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { and, eq } from 'drizzle-orm';

/**
 * Verify user owns this business
 */
async function verifyBusinessOwnership(businessId, userId) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) {
    throw new Error('Business not found or access denied');
  }

  return business;
}

/**
 * GET /api/audit/:businessId
 * Get audit logs for a business
 */
export const getAuditLogsHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const validationResult = auditLogQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const logs = await getAuditLogs(parseInt(businessId), {
      limit: validationResult.data.limit || 100,
      offset: validationResult.data.offset || 0,
      entityType: validationResult.data.entityType,
      action: validationResult.data.action,
      userId: validationResult.data.userId,
      startDate: validationResult.data.startDate,
      endDate: validationResult.data.endDate,
    });

    return res.status(200).json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (e) {
    logger.error('Error getting audit logs', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * GET /api/audit/:businessId/entity/:entityType/:entityId
 * Get audit logs for a specific entity
 */
export const getEntityAuditLogsHandler = async (req, res, next) => {
  try {
    const { businessId, entityType, entityId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const logs = await getEntityAuditLogs(
      parseInt(businessId),
      entityType,
      parseInt(entityId)
    );

    return res.status(200).json({
      success: true,
      count: logs.length,
      entityType,
      entityId: parseInt(entityId),
      logs,
    });
  } catch (e) {
    logger.error('Error getting entity audit logs', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * GET /api/audit/:businessId/user/:userId
 * Get audit logs for a specific user
 */
export const getUserAuditLogsHandler = async (req, res, next) => {
  try {
    const { businessId, userId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const limit = parseInt(req.query.limit) || 50;

    const logs = await getUserAuditLogs(parseInt(businessId), parseInt(userId), limit);

    return res.status(200).json({
      success: true,
      count: logs.length,
      userId: parseInt(userId),
      logs,
    });
  } catch (e) {
    logger.error('Error getting user audit logs', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * GET /api/audit/:businessId/summary
 * Get audit summary for dashboard
 */
export const getAuditSummaryHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const days = parseInt(req.query.days) || 7;

    const summary = await getAuditSummary(parseInt(businessId), days);

    return res.status(200).json({
      success: true,
      summary,
    });
  } catch (e) {
    logger.error('Error getting audit summary', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * POST /api/audit/:businessId/log
 * Manually log an audit event (for system use)
 */
export const createAuditLogHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { action, entityType, entityId, oldValues, newValues, metadata } = req.body;

    if (!action || !entityType) {
      return res.status(400).json({
        error: 'action and entityType are required',
      });
    }

    const log = await logAuditEvent({
      businessId: parseInt(businessId),
      userId: req.user.id,
      action,
      entityType,
      entityId,
      oldValues,
      newValues,
      metadata,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent'),
    });

    return res.status(201).json({
      success: true,
      message: 'Audit log created',
      log,
    });
  } catch (e) {
    logger.error('Error creating audit log', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};
