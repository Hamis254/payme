/**
 * =============================================================================
 * SERVICE: AUDIT
 * =============================================================================
 *
 * This file previously contained a full copy of the AUTH/refresh-token
 * service (wrong content under the wrong filename — that logic has been
 * restored to src/services/auth.service.js, where it belongs). This is the
 * real audit service, backed by the auditLogs table
 * (#models/auditLog.model.js), which audit.controller.js already expected
 * but which never actually existed.
 *
 * NOTE ON CALL-SITE INCONSISTENCY:
 * audit.controller.js calls logAuditEvent() with camelCase fields
 * (businessId, userId, entityType, oldValues, newValues...), while
 * revenueGuard.middleware.js calls it with a different, snake_case shape
 * (business_id, user_id, type, status, risk_score, amount_tokens...) and,
 * separately, doesn't even import it — that's a second bug (an undefined
 * function reference) that will throw if that middleware's rate-limit or
 * fraud-detection branch ever actually runs. This function accepts both
 * shapes defensively so it never throws regardless of which caller hits
 * it, but the missing import in revenueGuard.middleware.js still needs
 * fixing separately if/when you wire that middleware into a route.
 *
 * @module services/audit
 * =============================================================================
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { auditLogs } from '#models/auditLog.model.js';
import { startOfBusinessDay, endOfBusinessDay } from '#utils/businessDay.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOG AN EVENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write one row to the audit log. Accepts both the camelCase shape used by
 * audit.controller.js and the snake_case shape used by
 * revenueGuard.middleware.js — see module note above.
 *
 * @param {object} event
 * @returns {Promise<object>} the inserted row
 */
export const logAuditEvent = async event => {
  try {
    const businessId = event.businessId ?? event.business_id;
    const userId = event.userId ?? event.user_id ?? null;
    const entityType =
      event.entityType ?? event.entity_type ?? event.type ?? 'system';
    const entityId = event.entityId ?? event.entity_id ?? null;
    const action = event.action ?? event.status ?? event.type ?? 'unknown';
    const previousValue = event.oldValues ?? event.previous_value ?? null;
    const newValue = event.newValues ?? event.new_value ?? null;
    const description = event.description ?? event.reason ?? null;
    const ipAddress = event.ipAddress ?? event.ip_address ?? null;
    const userAgent = event.userAgent ?? event.user_agent ?? null;
    const riskLevel = event.riskLevel ?? event.risk_level ?? 'low';

    if (!businessId) {
      // Every row requires a business_id (NOT NULL) — log and skip rather
      // than crashing the caller's request over an audit-trail write.
      logger.warn('logAuditEvent called without businessId — skipping', {
        event,
      });
      return null;
    }

    // Anything not mapped to a dedicated column (risk_score, amount_tokens,
    // balance_before, balance_after, request_id, metadata, etc.) is kept
    // here so nothing gets silently dropped.
    const knownKeys = new Set([
      'businessId', 'business_id', 'userId', 'user_id', 'entityType',
      'entity_type', 'type', 'entityId', 'entity_id', 'action', 'status',
      'oldValues', 'previous_value', 'newValues', 'new_value',
      'description', 'reason', 'ipAddress', 'ip_address', 'userAgent',
      'user_agent', 'riskLevel', 'risk_level',
    ]);
    const extra = Object.fromEntries(
      Object.entries(event).filter(([k]) => !knownKeys.has(k))
    );

    const [log] = await db
      .insert(auditLogs)
      .values({
        business_id: businessId,
        user_id: userId,
        action: String(action).slice(0, 100),
        entity_type: String(entityType).slice(0, 100),
        entity_id: entityId,
        previous_value: previousValue,
        new_value: newValue,
        changed_fields: Object.keys(extra).length ? extra : null,
        description,
        ip_address: ipAddress,
        user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
        risk_level: riskLevel,
      })
      .returning();

    return log;
  } catch (e) {
    // Audit logging must never break the calling request — log and move on.
    logger.error('Error writing audit log', { error: e.message, event });
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// READ AUDIT LOGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/audit/:businessId — filtered/paginated audit log list.
 *
 * @param {number} businessId
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {number} [options.offset=0]
 * @param {string} [options.entityType]
 * @param {string} [options.action]
 * @param {number} [options.userId]
 * @param {string|Date} [options.startDate]
 * @param {string|Date} [options.endDate]
 * @returns {Promise<Array>}
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

    const conditions = [eq(auditLogs.business_id, businessId)];

    if (entityType) conditions.push(eq(auditLogs.entity_type, entityType));
    if (action) conditions.push(eq(auditLogs.action, action));
    if (userId) conditions.push(eq(auditLogs.user_id, userId));
    if (startDate) conditions.push(gte(auditLogs.created_at, startOfBusinessDay(startDate)));
    if (endDate) conditions.push(lte(auditLogs.created_at, endOfBusinessDay(endDate)));

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
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
 * GET /api/audit/:businessId/entity/:entityType/:entityId
 * All audit history for one specific record (e.g. one sale, one product).
 *
 * @param {number} businessId
 * @param {string} entityType
 * @param {number} entityId
 * @returns {Promise<Array>}
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
 * GET /api/audit/:businessId/user/:userId
 * Everything one user did within a business.
 *
 * @param {number} businessId
 * @param {number} userId
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export const getUserAuditLogs = async (businessId, userId, limit = 50) => {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.business_id, businessId), eq(auditLogs.user_id, userId))
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
 * GET /api/audit/:businessId/summary
 * Dashboard-friendly summary: counts by action and by risk level over the
 * last N days.
 *
 * @param {number} businessId
 * @param {number} [days=7]
 * @returns {Promise<object>}
 */
export const getAuditSummary = async (businessId, days = 7) => {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.business_id, businessId),
          gte(auditLogs.created_at, since)
        )
      );

    const byAction = {};
    const byRiskLevel = {};

    for (const row of rows) {
      byAction[row.action] = (byAction[row.action] || 0) + 1;
      byRiskLevel[row.risk_level] = (byRiskLevel[row.risk_level] || 0) + 1;
    }

    return {
      period_days: days,
      total_events: rows.length,
      by_action: byAction,
      by_risk_level: byRiskLevel,
    };
  } catch (e) {
    logger.error('Error getting audit summary', e);
    throw e;
  }
};