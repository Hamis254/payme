// audit.service.js
import { db } from '#config/database.js';
import { auditLogs } from '#models/auditLog.model.js';
import { and, eq, desc, gte, lte } from 'drizzle-orm';
import logger from '#config/logger.js';

/**
 * Log an audit event
 */
export const logAuditEvent = async (data) => {
  try {
    const [log] = await db
      .insert(auditLogs)
      .values({
        business_id: data.businessId,
        user_id: data.userId,
        action: data.action,
        entity_type: data.entityType,
        entity_id: data.entityId,
        old_values: data.oldValues || null,
        new_values: data.newValues || null,
        metadata: data.metadata || null,
        ip_address: data.ipAddress || null,
        user_agent: data.userAgent || null,
      })
      .returning();

    logger.info(`Audit event logged: ${data.action} on ${data.entityType}`, {
      logId: log.id,
      businessId: data.businessId,
      userId: data.userId,
    });

    return log;
  } catch (e) {
    logger.error('Error logging audit event', e);
    // Don't throw - audit logging should not break the main flow
  }
};

/**
 * Get audit logs for a business
 */
export const getAuditLogs = async (businessId, options = {}) => {
  try {
    const {
      limit = 100,
      offset = 0,
      entityType,
      action,
      userId,
      startDate,
      endDate,
    } = options;

    let query = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.business_id, businessId));

    if (entityType) {
      query = query.where(eq(auditLogs.entity_type, entityType));
    }
    if (action) {
      query = query.where(eq(auditLogs.action, action));
    }
    if (userId) {
      query = query.where(eq(auditLogs.user_id, userId));
    }
    if (startDate) {
      query = query.where(gte(auditLogs.created_at, new Date(startDate)));
    }
    if (endDate) {
      query = query.where(lte(auditLogs.created_at, new Date(endDate)));
    }

    const logs = await query
      .orderBy(desc(auditLogs.created_at))
      .limit(limit)
      .offset(offset);

    return logs;
  } catch (e) {
    logger.error('Error getting audit logs', e);
    throw e;
  }
};

/**
 * Get audit logs for a specific entity
 */
export const getEntityAuditLogs = async (businessId, entityType, entityId) => {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.business_id, businessId),
          eq(auditLogs.entity_type, entityType),
          eq(auditLogs.entity_id, entityId)
        )
      )
      .orderBy(desc(auditLogs.created_at));

    return logs;
  } catch (e) {
    logger.error('Error getting entity audit logs', e);
    throw e;
  }
};

/**
 * Get audit logs by user
 */
export const getUserAuditLogs = async (businessId, userId, limit = 50) => {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.business_id, businessId),
          eq(auditLogs.user_id, userId)
        )
      )
      .orderBy(desc(auditLogs.created_at))
      .limit(limit);

    return logs;
  } catch (e) {
    logger.error('Error getting user audit logs', e);
    throw e;
  }
};

/**
 * Get audit summary for dashboard
 */
export const getAuditSummary = async (businessId, days = 7) => {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get action counts
    const actionCounts = await db
      .select({
        action: auditLogs.action,
        count: db.count(),
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.business_id, businessId),
          gte(auditLogs.created_at, startDate)
        )
      )
      .groupBy(auditLogs.action);

    // Get entity type counts
    const entityCounts = await db
      .select({
        entity_type: auditLogs.entity_type,
        count: db.count(),
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.business_id, businessId),
          gte(auditLogs.created_at, startDate)
        )
      )
      .groupBy(auditLogs.entity_type);

    // Get most active users
    const userCounts = await db
      .select({
        user_id: auditLogs.user_id,
        count: db.count(),
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.business_id, businessId),
          gte(auditLogs.created_at, startDate)
        )
      )
      .groupBy(auditLogs.user_id)
      .orderBy(desc(db.count()))
      .limit(5);

    return {
      period: `${days} days`,
      totalEvents: actionCounts.reduce((sum, r) => sum + Number(r.count), 0),
      byAction: actionCounts.reduce((acc, r) => {
        acc[r.action] = Number(r.count);
        return acc;
      }, {}),
      byEntityType: entityCounts.reduce((acc, r) => {
        acc[r.entity_type] = Number(r.count);
        return acc;
      }, {}),
      topUsers: userCounts.map(r => ({
        userId: r.user_id,
        events: Number(r.count),
      })),
    };
  } catch (e) {
    logger.error('Error getting audit summary', e);
    throw e;
  }
};

/**
 * Create audit middleware wrapper
 * Use this to wrap functions that need audit logging
 */
export const withAuditLogging = (handler, options) => {
  return async (...args) => {
    const [businessId, userId, data] = args;
    
    try {
      const result = await handler(...args);
      
      // Log successful action
      await logAuditEvent({
        businessId,
        userId,
        action: options.action,
        entityType: options.entityType,
        entityId: result?.id,
        oldValues: options.oldValues,
        newValues: data,
        metadata: options.metadata,
      });
      
      return result;
    } catch (e) {
      // Log failed action
      await logAuditEvent({
        businessId,
        userId,
        action: `${options.action}_FAILED`,
        entityType: options.entityType,
        entityId: data?.id,
        oldValues: options.oldValues,
        newValues: data,
        metadata: { error: e.message },
      });
      throw e;
    }
  };
};
