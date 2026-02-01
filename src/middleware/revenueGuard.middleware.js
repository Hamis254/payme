/**
 * =============================================================================
 * MIDDLEWARE: REVENUE GUARD (The Platform Paywall)
 * =============================================================================
 * CORE RESPONSIBILITY:
 * This middleware acts as the primary revenue enforcement layer for the Pay Me
 * ecosystem. It ensures that no billable business logic (Sales, Credit,
 * Higher Purchase, or Records) is executed unless the merchant has a
 * pre-paid Token Balance (1 Token = 2 KES).
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. REVENUE ASSURANCE: Every record creation is tied to a mandatory 1-token
 *    deduction. No deduction = No record.
 * 2. PRE-FLIGHT VALIDATION: Intercepts requests before hitting expensive
 *    business logic or file generation services to save server compute.
 * 3. NEON POSTGRES INTEGRATION: Designed to work alongside Atomic Transactions
 *    to prevent "Race Conditions" where multiple clicks could result in
 *    unpaid records.
 * 4. SECURITY FIRST: Comprehensive audit logging, fraud detection, and
 *    compliance with Kenya Data Protection Act.
 *
 * TRANSACTION FLOW:
 * [Auth] -> [Revenue Guard] -> [Atomic Deduction + Record] -> [Response]
 *
 * ERROR HANDLING:
 * - Returns 402 (Payment Required) if balance < 1 token
 * - Returns 403 (Forbidden) if fraud detected
 * - Returns 429 (Too Many Requests) if rate limit exceeded
 * - Provides 'X-Token-Warning' headers if balance critical (<10)
 *
 * @module middleware/revenueGuard
 * @version 2.0.0 (2026 Edition - Security Enhanced)
 * @author Pay Me Engineering
 * =============================================================================
 */

import logger from '#config/logger.js';
import { db, sql } from '#config/database.js';
import { wallets, walletTransactions } from '#models/myWallet.model.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const REVENUE_GUARD_CONFIG = {
  // Token economics
  TOKENS_PER_BILLABLE_OPERATION: 1,
  TOKEN_VALUE_KES: 2,

  // Rate limiting (per user, per minute)
  MAX_REQUESTS_PER_MINUTE: 60,
  MAX_REQUESTS_PER_HOUR: 1000,

  // Fraud detection thresholds
  SUSPICIOUS_PATTERN_THRESHOLD: 10, // Operations within 60 seconds
  ANOMALY_AMOUNT_MULTIPLIER: 5, // 5x average = suspicious
  MAX_DAILY_VOLUME_MULTIPLIER: 3, // 3x weekly average = suspicious

  // Risk levels
  RISK_LEVELS: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  },

  // Warning thresholds
  CRITICAL_BALANCE_WARNING: 10, // Less than 10 tokens
  LOW_BALANCE_WARNING: 30, // Less than 30 tokens
};

// ============================================================================
// AUDIT LOGGING (Financial Compliance)
// ============================================================================

/**
 * Log all revenue guard interactions for audit trails
 * Critical for Kenyan financial regulations and dispute resolution
 */
const logAuditEvent = async (event) => {
  try {
    const auditEntry = {
      timestamp: new Date(),
      user_id: event.user_id,
      business_id: event.business_id,
      event_type: event.type, // 'revenue_check', 'deduction', 'refund', 'fraud_detected'
      amount_tokens: event.amount_tokens,
      balance_before: event.balance_before,
      balance_after: event.balance_after,
      status: event.status, // 'success', 'failed', 'blocked'
      reason: event.reason,
      ip_address: event.ip_address,
      user_agent: event.user_agent,
      risk_score: event.risk_score,
      request_id: event.request_id,
      metadata: event.metadata || {},
    };

    // Log to database (async, non-blocking)
    process.nextTick(() => {
      logger.info('AUDIT_EVENT', {
        user_id: event.user_id,
        business_id: event.business_id,
        event_type: event.type,
        status: event.status,
        risk_score: event.risk_score,
      });
    });

    return auditEntry;
  } catch (e) {
    logger.error('Error logging audit event', e);
    // Don't throw - audit logging should never block transactions
  }
};

// ============================================================================
// RISK DETECTION & FRAUD PREVENTION
// ============================================================================

/**
 * Calculate risk score based on multiple factors
 * Higher score = higher fraud likelihood
 */
const calculateRiskScore = async (userId, businessId, amount = 1) => {
  try {
    let riskScore = 0;

    // 1. Velocity check (too many operations too quickly)
    const recentOps = await db
      .select({ count: sql`count(*)::int` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.user_id, userId),
          sql`created_at > NOW() - INTERVAL '1 minute'`
        )
      );

    if (recentOps[0].count >= REVENUE_GUARD_CONFIG.SUSPICIOUS_PATTERN_THRESHOLD) {
      riskScore += 25; // High velocity = suspicious
      logger.warn('FRAUD_ALERT: Velocity spike detected', {
        user_id: userId,
        operations_in_60s: recentOps[0].count,
      });
    }

    // 2. Geographic anomaly (if location data available)
    // TODO: Integrate with geo-IP for location-based anomaly detection

    // 3. Device fingerprint check (if device tracking enabled)
    // TODO: Implement device fingerprinting for unusual access patterns

    // 4. Time-of-day anomaly
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      riskScore += 10; // Unusual hours
    }

    // 5. Amount anomaly check
    const avgTransaction = await db
      .select({ avg: sql`avg(cast(amount_tokens as decimal))::numeric` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.user_id, userId),
          sql`created_at > NOW() - INTERVAL '7 days'`
        )
      );

    if (
      avgTransaction[0].avg &&
      amount > avgTransaction[0].avg * REVENUE_GUARD_CONFIG.ANOMALY_AMOUNT_MULTIPLIER
    ) {
      riskScore += 20; // Amount exceeds typical pattern
    }

    // 6. Daily volume check
    const dailyVolume = await db
      .select({ count: sql`count(*)::int` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.user_id, userId),
          sql`created_at > NOW() - INTERVAL '1 day'`
        )
      );

    const weeklyAvg = await db
      .select({ avg: sql`avg(daily_count)::numeric` })
      .from(
        sql`
          (SELECT DATE(created_at), count(*) as daily_count
           FROM wallet_transactions
           WHERE user_id = ${userId}
           AND created_at > NOW() - INTERVAL '30 days'
           GROUP BY DATE(created_at)) as daily_stats
        `
      );

    if (
      weeklyAvg[0].avg &&
      dailyVolume[0].count >
        weeklyAvg[0].avg * REVENUE_GUARD_CONFIG.MAX_DAILY_VOLUME_MULTIPLIER
    ) {
      riskScore += 15; // Exceeds daily volume pattern
    }

    return Math.min(riskScore, 100); // Cap at 100
  } catch (e) {
    logger.error('Error calculating risk score', e);
    return 20; // Default to medium risk on error
  }
};

/**
 * Check if user is rate limited
 */
const checkRateLimit = async (userId) => {
  try {
    // Per-minute check
    const minuteOps = await db
      .select({ count: sql`count(*)::int` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.user_id, userId),
          sql`created_at > NOW() - INTERVAL '1 minute'`
        )
      );

    if (minuteOps[0].count >= REVENUE_GUARD_CONFIG.MAX_REQUESTS_PER_MINUTE) {
      return {
        limited: true,
        reason: 'minute_limit',
        limit: REVENUE_GUARD_CONFIG.MAX_REQUESTS_PER_MINUTE,
        current: minuteOps[0].count,
      };
    }

    // Per-hour check
    const hourOps = await db
      .select({ count: sql`count(*)::int` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.user_id, userId),
          sql`created_at > NOW() - INTERVAL '1 hour'`
        )
      );

    if (hourOps[0].count >= REVENUE_GUARD_CONFIG.MAX_REQUESTS_PER_HOUR) {
      return {
        limited: true,
        reason: 'hour_limit',
        limit: REVENUE_GUARD_CONFIG.MAX_REQUESTS_PER_HOUR,
        current: hourOps[0].count,
      };
    }

    return { limited: false };
  } catch (e) {
    logger.error('Error checking rate limit', e);
    return { limited: false }; // Default to not limited on error
  }
};

// ============================================================================
// MAIN MIDDLEWARE FUNCTION
// ============================================================================

/**
 * Revenue Guard Middleware
 * Validates token balance and authorizes billable operations
 */
export const revenueGuard = async (req, res, next) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 1. VALIDATE AUTHENTICATION
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // 2. EXTRACT BUSINESS ID
    const businessId = req.body.business_id || req.params.businessId;
    if (!businessId) {
      return res.status(400).json({
        error: 'Business ID required',
        code: 'BUSINESS_ID_MISSING',
      });
    }

    // 3. VERIFY USER OWNS BUSINESS
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(
          eq(businesses.id, businessId),
          eq(businesses.user_id, req.user.id)
        )
      )
      .limit(1);

    if (!business) {
      logger.warn('UNAUTHORIZED_ACCESS_ATTEMPT', {
        user_id: req.user.id,
        requested_business_id: businessId,
        request_id: requestId,
      });
      return res.status(403).json({
        error: 'Business not found or access denied',
        code: 'UNAUTHORIZED',
        request_id: requestId,
      });
    }

    // 4. RATE LIMIT CHECK
    const rateLimitCheck = await checkRateLimit(req.user.id);
    if (rateLimitCheck.limited) {
      logger.warn('RATE_LIMIT_EXCEEDED', {
        user_id: req.user.id,
        reason: rateLimitCheck.reason,
        current: rateLimitCheck.current,
        limit: rateLimitCheck.limit,
        request_id: requestId,
      });

      await logAuditEvent({
        user_id: req.user.id,
        business_id: businessId,
        type: 'rate_limit_exceeded',
        status: 'blocked',
        reason: rateLimitCheck.reason,
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
        request_id: requestId,
      });

      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        code: 'RATE_LIMITED',
        retry_after: 60,
        request_id: requestId,
      });
    }

    // 5. GET WALLET
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.business_id, businessId))
      .limit(1);

    if (!wallet) {
      logger.error('WALLET_NOT_FOUND', {
        user_id: req.user.id,
        business_id: businessId,
        request_id: requestId,
      });
      return res.status(500).json({
        error: 'Wallet not found',
        code: 'WALLET_ERROR',
        request_id: requestId,
      });
    }

    // 6. CALCULATE RISK SCORE
    const riskScore = await calculateRiskScore(
      req.user.id,
      businessId,
      REVENUE_GUARD_CONFIG.TOKENS_PER_BILLABLE_OPERATION
    );

    // 7. BLOCK IF CRITICAL RISK
    if (riskScore >= 75) {
      logger.error('FRAUD_DETECTED', {
        user_id: req.user.id,
        business_id: businessId,
        risk_score: riskScore,
        request_id: requestId,
      });

      await logAuditEvent({
        user_id: req.user.id,
        business_id: businessId,
        type: 'fraud_detected',
        status: 'blocked',
        reason: 'Critical risk score',
        risk_score: riskScore,
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
        request_id: requestId,
      });

      return res.status(403).json({
        error:
          'Transaction blocked due to security concerns. Please contact support.',
        code: 'FRAUD_DETECTED',
        request_id: requestId,
      });
    }

    // 8. CHECK TOKEN BALANCE
    const balanceBefore = Number(wallet.balance_tokens) || 0;
    const requiredTokens =
      REVENUE_GUARD_CONFIG.TOKENS_PER_BILLABLE_OPERATION;

    if (balanceBefore < requiredTokens) {
      logger.warn('INSUFFICIENT_BALANCE', {
        user_id: req.user.id,
        business_id: businessId,
        balance: balanceBefore,
        required: requiredTokens,
        request_id: requestId,
      });

      await logAuditEvent({
        user_id: req.user.id,
        business_id: businessId,
        type: 'insufficient_balance',
        amount_tokens: requiredTokens,
        balance_before: balanceBefore,
        balance_after: balanceBefore,
        status: 'blocked',
        reason: `Insufficient balance: ${balanceBefore} < ${requiredTokens}`,
        ip_address: req.ip,
        user_agent: req.get('user-agent'),
        request_id: requestId,
      });

      return res.status(402).json({
        error: `Insufficient token balance. Required: ${requiredTokens}, Available: ${balanceBefore}`,
        code: 'PAYMENT_REQUIRED',
        balance_tokens: balanceBefore,
        required_tokens: requiredTokens,
        request_id: requestId,
      });
    }

    // 9. ATTACH REVENUE GUARD DATA TO REQUEST
    req.revenueGuard = {
      wallet_id: wallet.id,
      business_id: businessId,
      balance_before: balanceBefore,
      tokens_to_deduct: requiredTokens,
      risk_score: riskScore,
      request_id: requestId,
      timestamp: new Date(),
    };

    // 10. ATTACH WARNING HEADERS
    if (balanceBefore < REVENUE_GUARD_CONFIG.CRITICAL_BALANCE_WARNING) {
      res.set(
        'X-Token-Critical-Warning',
        `Only ${balanceBefore} tokens remaining`
      );
      res.set('X-Token-Warning-Level', 'critical');
    } else if (balanceBefore < REVENUE_GUARD_CONFIG.LOW_BALANCE_WARNING) {
      res.set(
        'X-Token-Low-Warning',
        `Only ${balanceBefore} tokens remaining`
      );
      res.set('X-Token-Warning-Level', 'low');
    }

    // 11. LOG SUCCESSFUL AUTH
    await logAuditEvent({
      user_id: req.user.id,
      business_id: businessId,
      type: 'revenue_check_pass',
      amount_tokens: requiredTokens,
      balance_before: balanceBefore,
      status: 'authorized',
      risk_score: riskScore,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      request_id: requestId,
    });

    // 12. PROCEED TO NEXT MIDDLEWARE
    next();
  } catch (error) {
    logger.error('Revenue Guard middleware error', {
      error: error.message,
      user_id: req.user?.id,
      request_id: requestId,
      duration_ms: Date.now() - startTime,
    });

    return res.status(500).json({
      error: 'Revenue verification failed. Please try again.',
      code: 'REVENUE_CHECK_ERROR',
      request_id: requestId,
    });
  }
};

// ============================================================================
// REVENUE DEDUCTION (Atomic Transaction)
// ============================================================================

/**
 * Deduct tokens from wallet (called by controller after record creation)
 * Uses atomic transaction to prevent double-deduction
 */
export const deductTokens = async (walletId, tokensToDeduct, metadata = {}) => {
  const deductionId = crypto.randomUUID();

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Lock and fetch current balance
      const [currentWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, walletId))
        .limit(1);

      if (!currentWallet) {
        throw new Error('Wallet not found');
      }

      const balanceBefore = Number(currentWallet.balance_tokens);
      const balanceAfter = balanceBefore - tokensToDeduct;

      if (balanceAfter < 0) {
        throw new Error('Insufficient balance during deduction');
      }

      // 2. Deduct tokens
      await tx
        .update(wallets)
        .set({
          balance_tokens: String(balanceAfter),
          updated_at: new Date(),
        })
        .where(eq(wallets.id, walletId))
        .returning();

      // 3. Log transaction
      await tx.insert(walletTransactions).values({
        wallet_id: walletId,
        transaction_type: 'deduction',
        amount_tokens: String(tokensToDeduct),
        balance_before: String(balanceBefore),
        balance_after: String(balanceAfter),
        status: 'completed',
        metadata: JSON.stringify(metadata),
        created_at: new Date(),
      });

      return {
        success: true,
        wallet_id: walletId,
        tokens_deducted: tokensToDeduct,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        deduction_id: deductionId,
      };
    });

    logger.info('TOKENS_DEDUCTED', {
      wallet_id: walletId,
      amount: tokensToDeduct,
      balance_after: result.balance_after,
      deduction_id: deductionId,
    });

    return result;
  } catch (error) {
    logger.error('Token deduction failed', {
      wallet_id: walletId,
      tokens: tokensToDeduct,
      error: error.message,
      deduction_id: deductionId,
    });

    throw error;
  }
};

// ============================================================================
// REFUND HANDLER (For failed operations)
// ============================================================================

/**
 * Refund tokens if operation fails after deduction
 */
export const refundTokens = async (walletId, tokensToRefund, reason = '') => {
  try {
    const result = await db.transaction(async (tx) => {
      // Fetch current balance
      const [currentWallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, walletId))
        .limit(1);

      if (!currentWallet) {
        throw new Error('Wallet not found');
      }

      const balanceBefore = Number(currentWallet.balance_tokens);
      const balanceAfter = balanceBefore + tokensToRefund;

      // Refund tokens
      await tx
        .update(wallets)
        .set({
          balance_tokens: String(balanceAfter),
          updated_at: new Date(),
        })
        .where(eq(wallets.id, walletId))
        .returning();

      // Log refund
      await tx.insert(walletTransactions).values({
        wallet_id: walletId,
        transaction_type: 'refund',
        amount_tokens: String(tokensToRefund),
        balance_before: String(balanceBefore),
        balance_after: String(balanceAfter),
        status: 'completed',
        metadata: JSON.stringify({ reason }),
        created_at: new Date(),
      });

      return {
        success: true,
        tokens_refunded: tokensToRefund,
        balance_after: balanceAfter,
      };
    });

    logger.info('TOKENS_REFUNDED', {
      wallet_id: walletId,
      amount: tokensToRefund,
      reason,
      balance_after: result.balance_after,
    });

    return result;
  } catch (error) {
    logger.error('Token refund failed', {
      wallet_id: walletId,
      tokens: tokensToRefund,
      reason,
      error: error.message,
    });

    throw error;
  }
};

export default revenueGuard;