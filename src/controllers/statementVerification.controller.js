/**
 * =============================================================================
 * CONTROLLER: STATEMENT VERIFICATION (QR Code Scanning)
 * =============================================================================
 * Handles QR code verification endpoints for bank officers
 * Checks fingerprints, detects fraud, and logs verification attempts
 *
 * @module controllers/statementVerification
 * =============================================================================
 */

import logger from '#config/logger.js';
import { verifyStatementQRCode } from '#services/statementService.js';

/**
 * VERIFY STATEMENT QR CODE ENDPOINT
 * 
 * Bank officers scan the QR code from the PDF statement
 * This endpoint verifies the code exists and checks for tampering
 * 
 * Request body:
 * {
 *   "verification_code": "ABC-DEF-GHI",
 *   "provided_fingerprint": "sha256hash...",  (optional)
 *   "device_fingerprint": "device123..."      (optional)
 * }
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
export const verifyStatementHandler = async (req, res, next) => {
  try {
    const { verification_code, provided_fingerprint, device_fingerprint } =
      req.body;

    // Validate verification code format
    if (!verification_code || !/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(verification_code)) {
      return res.status(400).json({
        error: 'Invalid verification code format',
        expected_format: 'ABC-DEF-GHI',
        provided: verification_code,
      });
    }

    // Get IP address of bank officer
    const ipAddress =
      req.ip ||
      req.connection.remoteAddress ||
      req.headers['x-forwarded-for'] ||
      '0.0.0.0';

    const userAgent = req.get('User-Agent') || 'Unknown';

    logger.info('Statement verification request', {
      verification_code,
      ipAddress,
      hasFingerprint: !!provided_fingerprint,
    });

    // Verify the statement
    const verificationResult = await verifyStatementQRCode(
      verification_code,
      provided_fingerprint || null,
      ipAddress,
      userAgent,
      device_fingerprint || null
    );

    // Return verification result
    const statusCode =
      verificationResult.fraud_detected || !verificationResult.verified ? 403 : 200;

    logger.info('Verification result', {
      verification_code,
      verified: verificationResult.verified,
      fraudDetected: verificationResult.fraud_detected,
      statusCode,
    });

    return res.status(statusCode).json(verificationResult);
  } catch (error) {
    logger.error('Verification endpoint error', {
      error: error.message,
    });
    next(error);
  }
};

/**
 * GET STATEMENT AUDIT DETAILS (Admin only)
 * Retrieves full audit log for a verification code
 * 
 * @param {Object} req - Express request with params.code
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
export const getStatementAuditHandler = async (req, res, next) => {
  try {
    const { code } = req.params;

    // Only admin users can view audit logs
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Only admins can view audit logs',
      });
    }

    // TODO: Fetch audit log from database
    // const auditLog = await db.select().from(statementAuditLogs)
    //   .where(eq(statementAuditLogs.verification_code, code))
    //   .limit(1);

    return res.status(200).json({
      message: 'Audit log endpoint - implement database query',
      code,
    });
  } catch (error) {
    logger.error('Audit details endpoint error', {
      error: error.message,
    });
    next(error);
  }
};

/**
 * LIST SUSPICIOUS STATEMENTS (Admin only)
 * Find statements that failed verification (possible fraud)
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
export const listSuspiciousStatementsHandler = async (req, res, next) => {
  try {
    // Only admin users can view fraud alerts
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Only admins can view fraud alerts',
      });
    }

    // TODO: Query suspicious statements from database
    // const suspiciousStatements = await db.select().from(statementAuditLogs)
    //   .where(eq(statementAuditLogs.is_suspicious, 1))
    //   .orderBy(desc(statementAuditLogs.created_at));

    return res.status(200).json({
      message: 'Suspicious statements endpoint - implement database query',
      suspicious_count: 0,
      statements: [],
    });
  } catch (error) {
    logger.error('Suspicious statements endpoint error', {
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
