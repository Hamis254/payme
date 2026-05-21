/**
 * =============================================================================
 * CONTROLLER: STATEMENT VERIFICATION (QR Code Scanning)
 * =============================================================================
 * Three endpoints:
 *
 *   POST /api/verify/statement          — public; called when a bank officer
 *                                         scans the QR code on a PDF statement.
 *                                         Delegates to statementService which
 *                                         does the fingerprint comparison and
 *                                         writes the verification_checks row.
 *
 *   GET  /api/verify/audit/:code        — admin only; returns the full audit
 *                                         record for a given verification code
 *                                         PLUS every scan attempt logged in
 *                                         statement_verification_checks.
 *
 *   GET  /api/verify/suspicious         — admin only; returns all audit rows
 *                                         where is_suspicious = 1 (fingerprint
 *                                         mismatch detected), ordered newest
 *                                         first, with pagination support.
 *
 * @module controllers/statementVerification
 * =============================================================================
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import {
  statementAuditLogs,
  statementVerificationChecks,
} from '#models/statementAudit.model.js';
import { eq, desc, and } from 'drizzle-orm';
import { verifyStatementQRCode } from '#services/statementService.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that a string matches the XXX-XXX-XXX verification code format.
 * Only uppercase letters A-Z and digits 2-9 are used (ambiguous chars removed).
 */
const VERIFICATION_CODE_REGEX = /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/;

const isValidVerificationCode = code =>
  typeof code === 'string' && VERIFICATION_CODE_REGEX.test(code);

// ─────────────────────────────────────────────────────────────────────────────
// 1. VERIFY STATEMENT (public endpoint)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/verify/statement
 *
 * Called when a bank officer scans the QR code embedded in a PDF statement.
 * The heavy lifting (DB lookup, fingerprint comparison, writing the
 * verification_checks row) is handled by verifyStatementQRCode in
 * statementService.js — this controller only validates the request shape,
 * collects metadata, and maps the service result to an HTTP response.
 *
 * Request body:
 * {
 *   "verification_code":    "ABC-DEF-GHI",           // required
 *   "provided_fingerprint": "sha256hexstring...",     // optional
 *   "device_fingerprint":   "device123..."            // optional
 * }
 *
 * Responses:
 *   200  — document is authentic, fingerprint matched
 *   400  — malformed verification code
 *   403  — document not found (forged) or fingerprint mismatch (tampered)
 */
export const verifyStatementHandler = async (req, res, next) => {
  try {
    const { verification_code, provided_fingerprint, device_fingerprint } =
      req.body;

    // Validate format before hitting the DB
    if (!isValidVerificationCode(verification_code)) {
      return res.status(400).json({
        error: 'Invalid verification code format',
        message:
          'Verification code must be in XXX-XXX-XXX format ' +
          '(uppercase letters and digits only, e.g. ABC-DEF-GHI)',
        provided: verification_code ?? null,
      });
    }

    // Collect request metadata for the audit trail
    const ipAddress =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '0.0.0.0';

    const userAgent = req.get('User-Agent') || 'Unknown';

    logger.info('Statement verification request received', {
      verification_code,
      ipAddress,
      hasFingerprint: !!provided_fingerprint,
      hasDeviceFingerprint: !!device_fingerprint,
    });

    // Delegate to service — it owns all DB reads/writes for this flow
    const result = await verifyStatementQRCode(
      verification_code,
      provided_fingerprint ?? null,
      ipAddress,
      userAgent,
      device_fingerprint ?? null
    );

    // Map fraud/not-verified → 403; authentic → 200
    const statusCode = result.fraud_detected || !result.verified ? 403 : 200;

    logger.info('Statement verification complete', {
      verification_code,
      verified: result.verified,
      fraud_detected: result.fraud_detected,
      alert_level: result.alert_level,
      statusCode,
    });

    return res.status(statusCode).json(result);
  } catch (error) {
    logger.error('verifyStatementHandler error', { error: error.message });
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET AUDIT DETAILS  (admin only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/verify/audit/:code
 *
 * Returns the full audit record for a verification code together with every
 * scan attempt recorded in statement_verification_checks.  This gives an admin
 * a complete picture:
 *   - Who generated the statement (issued_by_user_id)
 *   - The exact SHA-256 fingerprint stored at generation time
 *   - Every IP/device that ever scanned this QR code
 *   - Whether any scan produced a fingerprint mismatch (fraud flag)
 *
 * Responses:
 *   200  — audit record + scan history returned
 *   400  — malformed verification code in URL param
 *   403  — caller is not an admin
 *   404  — no audit record exists for this code
 */
export const getStatementAuditHandler = async (req, res, next) => {
  try {
    const { code } = req.params;

    if (!isValidVerificationCode(code)) {
      return res.status(400).json({
        error: 'Invalid verification code format',
        message: 'Code must be in XXX-XXX-XXX format (e.g. ABC-DEF-GHI)',
        provided: code ?? null,
      });
    }

    // ── Fetch the core audit log row ────────────────────────────────────────
    const [auditLog] = await db
      .select()
      .from(statementAuditLogs)
      .where(eq(statementAuditLogs.verification_code, code))
      .limit(1);

    if (!auditLog) {
      logger.warn('Audit record not found', { code });
      return res.status(404).json({
        error: 'Audit record not found',
        message: `No statement has been generated with verification code: ${code}`,
      });
    }

    // ── Fetch every scan attempt for this statement ─────────────────────────
    const scanHistory = await db
      .select()
      .from(statementVerificationChecks)
      .where(eq(statementVerificationChecks.statement_audit_id, auditLog.id))
      .orderBy(desc(statementVerificationChecks.created_at));

    logger.info('Statement audit details fetched', {
      code,
      auditId: auditLog.id,
      scanCount: scanHistory.length,
    });

    // ── Shape the response ──────────────────────────────────────────────────
    return res.status(200).json({
      audit: {
        id: auditLog.id,
        business_id: auditLog.business_id,
        verification_code: auditLog.verification_code,

        // Cryptographic fingerprint — if ANY transaction amount was altered
        // the sha256_fingerprint stored here will no longer match a fresh hash
        sha256_fingerprint: auditLog.sha256_fingerprint,
        transaction_data_hash: auditLog.transaction_data_hash,

        // Statement period & volume
        statement_start_date: auditLog.statement_start_date,
        statement_end_date: auditLog.statement_end_date,
        record_count: auditLog.record_count,

        // PDF security metadata (read-only flag, encryption status, etc.)
        pdf_metadata: auditLog.pdf_metadata,

        // QR code URL that was embedded in the PDF
        qr_verification_url: auditLog.qr_verification_url,

        // Verification state
        is_verified: auditLog.is_verified === 1,
        verification_timestamp: auditLog.verification_timestamp ?? null,
        verification_ip: auditLog.verification_ip ?? null,
        verification_user_agent: auditLog.verification_user_agent ?? null,

        // Fraud flags
        is_suspicious: auditLog.is_suspicious === 1,
        suspension_reason: auditLog.suspension_reason ?? null,

        // Issuing officer
        issued_by_user_id: auditLog.issued_by_user_id ?? null,
        issued_by_email: auditLog.issued_by_email ?? null,

        // Timestamps
        created_at: auditLog.created_at,
        updated_at: auditLog.updated_at,
      },

      // Full history of every QR scan attempt
      scan_history: scanHistory.map(scan => ({
        id: scan.id,
        scanned_at: scan.created_at,
        verification_ip: scan.verification_ip,
        user_agent: scan.user_agent ?? null,
        device_fingerprint: scan.device_fingerprint ?? null,
        fingerprint_matched: scan.fingerprint_matched === 1,
        // Expose only a prefix of the hashes — enough to spot differences
        // without leaking the full fingerprint in a list endpoint
        stored_fingerprint_preview:
          scan.stored_fingerprint?.substring(0, 16) + '...',
        provided_fingerprint_preview: scan.provided_fingerprint
          ? scan.provided_fingerprint.substring(0, 16) + '...'
          : null,
        verified_by_email: scan.verified_by_email ?? null,
        verified_by_bank: scan.verified_by_bank ?? null,
      })),

      summary: {
        total_scan_attempts: scanHistory.length,
        successful_verifications: scanHistory.filter(
          s => s.fingerprint_matched === 1
        ).length,
        failed_verifications: scanHistory.filter(
          s => s.fingerprint_matched === 0
        ).length,
        is_suspicious: auditLog.is_suspicious === 1,
      },
    });
  } catch (error) {
    logger.error('getStatementAuditHandler error', { error: error.message });
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. LIST SUSPICIOUS STATEMENTS  (admin only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/verify/suspicious
 *
 * Returns all audit records where is_suspicious = 1, meaning at least one
 * verification attempt produced a fingerprint mismatch — a strong signal the
 * PDF was tampered with after generation.
 *
 * Supports simple pagination via query params:
 *   ?page=1&limit=20
 *
 * For each suspicious statement we also return its scan_history filtered to
 * only the FAILED scans — so the admin can see the IPs/devices that attempted
 * to pass off the forged document.
 *
 * Responses:
 *   200  — list of suspicious statements (may be empty)
 *   403  — caller is not an admin
 */
export const listSuspiciousStatementsHandler = async (req, res, next) => {
  try {
    // ── Pagination ──────────────────────────────────────────────────────────
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit ?? '20', 10))
    );
    const offset = (page - 1) * limit;

    // ── Fetch all suspicious audit rows, newest first ───────────────────────
    // Drizzle doesn't have a built-in count + data in one call against Neon's
    // HTTP driver, so we do two lightweight queries.
    const suspiciousRows = await db
      .select()
      .from(statementAuditLogs)
      .where(eq(statementAuditLogs.is_suspicious, 1))
      .orderBy(desc(statementAuditLogs.created_at))
      .limit(limit)
      .offset(offset);

    // Total count for pagination metadata (separate query)
    const allSuspicious = await db
      .select({ id: statementAuditLogs.id })
      .from(statementAuditLogs)
      .where(eq(statementAuditLogs.is_suspicious, 1));

    const totalCount = allSuspicious.length;

    // ── For each suspicious statement, pull the failed scans ────────────────
    // Batch the check IDs to avoid N+1 queries
    const auditIds = suspiciousRows.map(r => r.id);

    let failedScans = [];
    if (auditIds.length > 0) {
      // Fetch all failed verification checks for these audit records in one go
      failedScans = await db
        .select()
        .from(statementVerificationChecks)
        .where(
          and(
            // fingerprint_matched = 0 means fraud was detected on that scan
            eq(statementVerificationChecks.fingerprint_matched, 0)
          )
        )
        .orderBy(desc(statementVerificationChecks.created_at));

      // Filter to only the audit IDs we care about (Drizzle neon-http driver
      // doesn't support inArray on all Neon plan tiers without the full
      // postgres driver, so we filter in JS — the set is already small because
      // fraud events are rare)
      failedScans = failedScans.filter(s =>
        auditIds.includes(s.statement_audit_id)
      );
    }

    // Group failed scans by their parent audit ID for O(1) lookups below
    const failedScansByAuditId = {};
    for (const scan of failedScans) {
      if (!failedScansByAuditId[scan.statement_audit_id]) {
        failedScansByAuditId[scan.statement_audit_id] = [];
      }
      failedScansByAuditId[scan.statement_audit_id].push(scan);
    }

    // ── Shape the response ──────────────────────────────────────────────────
    const statements = suspiciousRows.map(row => ({
      id: row.id,
      business_id: row.business_id,
      verification_code: row.verification_code,
      suspension_reason: row.suspension_reason ?? null,
      sha256_fingerprint_preview:
        row.sha256_fingerprint.substring(0, 16) + '...',

      // Statement period
      statement_start_date: row.statement_start_date,
      statement_end_date: row.statement_end_date,
      record_count: row.record_count,

      // Who generated it
      issued_by_user_id: row.issued_by_user_id ?? null,
      issued_by_email: row.issued_by_email ?? null,

      // When generated
      generated_at: row.created_at,

      // Failed scans that triggered the fraud flag
      failed_scan_attempts: (failedScansByAuditId[row.id] ?? []).map(scan => ({
        id: scan.id,
        scanned_at: scan.created_at,
        verification_ip: scan.verification_ip,
        user_agent: scan.user_agent ?? null,
        device_fingerprint: scan.device_fingerprint ?? null,
        provided_fingerprint_preview: scan.provided_fingerprint
          ? scan.provided_fingerprint.substring(0, 16) + '...'
          : null,
        verified_by_bank: scan.verified_by_bank ?? null,
      })),

      failed_attempt_count: (failedScansByAuditId[row.id] ?? []).length,
    }));

    logger.info('Suspicious statements listed', {
      count: statements.length,
      totalCount,
      page,
      limit,
    });

    return res.status(200).json({
      suspicious_statements: statements,
      pagination: {
        page,
        limit,
        total_count: totalCount,
        total_pages: Math.ceil(totalCount / limit),
        has_next_page: page * limit < totalCount,
        has_prev_page: page > 1,
      },
      summary: {
        total_suspicious: totalCount,
        message:
          totalCount === 0
            ? 'No suspicious statements detected'
            : `${totalCount} statement(s) flagged for potential tampering`,
      },
    });
  } catch (error) {
    logger.error('listSuspiciousStatementsHandler error', {
      error: error.message,
    });
    next(error);
  }
};

export default {
  verifyStatementHandler,
  getStatementAuditHandler,
  listSuspiciousStatementsHandler,
};
