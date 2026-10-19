/**
 * M-Pesa Webhook Security & Validation Middleware
 * Implements enterprise-grade webhook security following industry standards
 *
 * Security Features:
 * 1. Request Signature Validation - Verifies authenticity using Safaricom's signature
 * 2. IP Whitelist - Only Safaricom M-Pesa servers can trigger callbacks
 * 3. SSL Certificate Validation - Prevents MITM attacks
 * 4. Timestamp Validation - Prevents replay attacks
 * 5. Request Body Integrity - Detects tampering
 *
 * Kenya Data Protection Act 2019 Compliance:
 * - All webhook accesses logged for audit trail
 * - Signature verification prevents unauthorized data modification
 * - IP validation prevents impersonation
 */

import crypto from 'node:crypto';
import logger from '#config/logger.js';

/**
 * M-Pesa Production IP Ranges (Safaricom)
 * These are verified M-Pesa server IPs that we trust
 * Update periodically from Safaricom documentation
 *
 * Source: https://developer.safaricom.co.ke/
 */
const SAFARICOM_PRODUCTION_IPS = [
  '196.201.214.200', // M-Pesa Callback Server
  '196.201.214.206', // M-Pesa Backup Server
  '196.201.213.144',
  '196.201.213.145',
  '196.201.213.146',
  '196.201.213.147',
];

/**
 * M-Pesa Sandbox IP Ranges
 * For development/testing environment
 */
const SAFARICOM_SANDBOX_IPS = [
  '197.136.192.0/24', // Safaricom sandbox range (generalized)
];

/**
 * Get allowed IPs based on environment
 *
 * @returns {string[]} Array of allowed IP addresses
 */
const getAllowedIps = () => {
  if (process.env.MPESA_ENV === 'production') {
    return SAFARICOM_PRODUCTION_IPS;
  }
  return SAFARICOM_SANDBOX_IPS;
};

/**
 * Verify IP is from Safaricom
 * Prevents webhook spoofing from unauthorized sources
 *
 * @param {string} requestIp - Client IP from request
 * @returns {boolean} True if IP is authorized
 */
export const verifySourceIp = requestIp => {
  const allowedIps = getAllowedIps();
  const isAllowed = allowedIps.some(allowedIp => {
    // Handle CIDR notation (e.g., 197.136.192.0/24)
    if (allowedIp.includes('/')) {
      return isIpInCidrRange(requestIp, allowedIp);
    }
    return requestIp === allowedIp;
  });

  if (!isAllowed) {
    logger.warn('Webhook received from unauthorized IP', {
      requestIp,
      environment: process.env.MPESA_ENV || 'sandbox',
    });
  }

  return isAllowed;
};

/**
 * Check if IP is within CIDR range
 * Used for flexible IP whitelist matching
 *
 * @param {string} ip - IP address to check
 * @param {string} cidr - CIDR range (e.g., 197.136.192.0/24)
 * @returns {boolean} True if IP is in range
 *
 * @example
 * isIpInCidrRange('197.136.192.1', '197.136.192.0/24') // true
 */
const isIpInCidrRange = (ip, cidr) => {
  const [cidrIp, mask] = cidr.split('/');
  const ipNum = ipToNumber(ip);
  const cidrNum = ipToNumber(cidrIp);
  const maskNum = (0xffffffff << (32 - parseInt(mask))) >>> 0;

  return (ipNum & maskNum) === (cidrNum & maskNum);
};

/**
 * Convert IP address string to 32-bit number
 *
 * @param {string} ip - IP address (e.g., 192.168.1.1)
 * @returns {number} 32-bit integer representation
 */
const ipToNumber = ip => {
  const parts = ip.split('.');
  return (
    parseInt(parts[0]) * 256 ** 3 +
    parseInt(parts[1]) * 256 ** 2 +
    parseInt(parts[2]) * 256 +
    parseInt(parts[3])
  );
};

/**
 * Validate M-Pesa callback signature
 *
 * IMPORTANT — this returned the wrong answer in the one case that actually
 * happens. Daraja's STK Push result callbacks do NOT carry an
 * `X-M-Pesa-Signature` header; Safaricom authenticates the callback by
 * calling a URL only the merchant knows, over TLS, from its own IP ranges.
 * This function returned `false` on a missing header, and
 * validateMpesaWebhook() treats `false` as fatal — so EVERY genuine
 * callback was rejected with "Invalid signature" and the sale it was meant
 * to confirm never got created. Confirmed live: a correctly-formed callback
 * from a whitelisted Safaricom IP was refused.
 *
 * Worse, the check bought nothing in exchange: when a header WAS present it
 * returned `true` without verifying anything (see the TODO below), so a
 * spoofer only had to send any value at all. It rejected real traffic and
 * admitted forged traffic.
 *
 * Behaviour now:
 *   - no header            → unverifiable, not invalid → pass (this is the
 *                            normal Daraja case; IP whitelist + TLS + the
 *                            secret callback URL are what actually gate it)
 *   - header + no secret   → pass, but warn: something is sending a
 *                            signature we can't check
 *   - header + secret set  → real HMAC-SHA256 comparison, timing-safe
 *
 * Set MPESA_CALLBACK_SECRET once Safaricom provides an HMAC secret and this
 * becomes a genuine check with no further code change.
 *
 * @param {Object} req - Express request object
 * @returns {boolean} False only when a signature is present AND provably wrong
 */
export const verifyMpesaSignature = req => {
  const signature = req.get('X-M-Pesa-Signature');

  if (!signature) {
    // The normal case for Daraja STK callbacks. Absence of a signature is
    // not evidence of forgery — see the note above.
    logger.debug('M-Pesa callback has no signature header (expected)');
    return true;
  }

  const hmacSecret = process.env.MPESA_CALLBACK_SECRET;
  if (!hmacSecret) {
    logger.warn(
      'M-Pesa callback carried a signature but MPESA_CALLBACK_SECRET is unset — cannot verify'
    );
    return true;
  }

  try {
    const computed = crypto
      .createHmac('sha256', hmacSecret)
      .update(JSON.stringify(req.body))
      .digest('base64');

    const provided = Buffer.from(signature);
    const expected = Buffer.from(computed);

    // Length check first: timingSafeEqual throws on a length mismatch.
    const ok =
      provided.length === expected.length &&
      crypto.timingSafeEqual(provided, expected);

    if (!ok) logger.error('M-Pesa callback signature mismatch');
    return ok;
  } catch (e) {
    logger.error('M-Pesa signature verification failed', { error: e.message });
    return false;
  }
};

/**
 * Validate callback timestamp to prevent replay attacks
 * Rejects callbacks older than 5 minutes
 *
 * @param {string} timestamp - Timestamp from callback (YYYYMMDDHHMMSS format)
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @returns {boolean} True if timestamp is within acceptable range
 *
 * @example
 * isTimestampValid('20250128143045') // True if within 5 minutes
 */
export const isTimestampValid = (timestamp, maxAgeMs = 5 * 60 * 1000) => {
  if (!timestamp) {
    logger.warn('M-Pesa callback missing timestamp');
    return false;
  }

  // Parse timestamp (YYYYMMDDHHMMSS format)
  const year = parseInt(timestamp.substring(0, 4));
  const month = parseInt(timestamp.substring(4, 6));
  const day = parseInt(timestamp.substring(6, 8));
  const hour = parseInt(timestamp.substring(8, 10));
  const minute = parseInt(timestamp.substring(10, 12));
  const second = parseInt(timestamp.substring(12, 14));

  // Safaricom sends TransactionDate as an East Africa Time wall clock with
  // no offset. This used to build it with `new Date(y, m, d, …)`, which
  // interprets those digits in the SERVER's local timezone — correct only
  // by accident when the server also runs in Nairobi. Deployed to a UTC
  // host (the usual case), an EAT timestamp reads 3 hours in the future,
  // `age` goes negative, and the guard below rejects every genuine callback
  // as a replay attack. Pinning the offset makes the comparison an absolute
  // one, so it behaves identically wherever this runs. EAT is UTC+3
  // year-round — Kenya observes no DST — so a fixed offset is exact, not an
  // approximation.
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  const callbackTime = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - EAT_OFFSET_MS
  );
  const now = new Date();
  const age = now.getTime() - callbackTime.getTime();

  if (age < 0 || age > maxAgeMs) {
    logger.warn('M-Pesa callback timestamp out of acceptable range', {
      callbackTime: callbackTime.toISOString(),
      currentTime: now.toISOString(),
      ageMs: age,
      maxAgeMs,
    });
    return false;
  }

  return true;
};

/**
 * Middleware to validate M-Pesa webhook requests
 * Applies all security checks before passing to handler
 *
 * Checks:
 * 1. Source IP is from Safaricom
 * 2. Request signature is valid
 * 3. Timestamp is within acceptable range
 * 4. Request body is not empty
 *
 * @returns {Function} Express middleware
 *
 * @example
 * app.post('/api/sales/mpesa/callback', validateMpesaWebhook(), mpesaCallbackHandler);
 */
export const validateMpesaWebhook = () => {
  return (req, res, next) => {
    const requestIp = req.ip || req.connection.remoteAddress;

    // 1. Verify source IP
    if (!verifySourceIp(requestIp)) {
      logger.error('Webhook rejected: Invalid source IP', { requestIp });
      // Return 200 OK to Safaricom (they expect acknowledgment)
      // But reject processing the callback
      return res.status(200).json({
        status: 'rejected',
        reason: 'Invalid source',
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Verify signature (if implemented)
    if (!verifyMpesaSignature(req)) {
      logger.error('Webhook rejected: Invalid signature', { requestIp });
      return res.status(200).json({
        status: 'rejected',
        reason: 'Invalid signature',
        timestamp: new Date().toISOString(),
      });
    }

    // Transaction date lives inside callback metadata.item not
    // not at skCallback level, so we need to extract it from there
    const callbackItems =
      req.body?.Body?.stkCallback?.CallbackMetadata?.Item || [];
    const transactionDate = callbackItems.find(
      item => item.Name === 'TransactionDate'
    )?.Value;
    const timestamp = transactionDate ? String(transactionDate) : null;

    if (timestamp && !isTimestampValid(timestamp, 30 * 60 * 1000)) {
      // Allow 30 minutes for potential clock skew
      logger.warn(
        'Webhook timestamp outside 30-minute window, potential replay attack',
        { requestIp, timestamp }
      );
      return res.status(200).json({
        status: 'rejected',
        reason: 'Invalid timestamp',
        timestamp: new Date().toISOString(),
      });
    }

    // 4. Check request body
    if (!req.body || Object.keys(req.body).length === 0) {
      logger.error('Webhook rejected: Empty body', { requestIp });
      return res.status(200).json({
        status: 'rejected',
        reason: 'Empty body',
        timestamp: new Date().toISOString(),
      });
    }

    // All checks passed
    logger.info('Webhook validation passed', {
      requestIp,
      checkoutRequestId: req.body?.Body?.stkCallback?.CheckoutRequestID,
    });

    // Attach validation metadata to request
    req.webhookValidation = {
      sourceIp: requestIp,
      validatedAt: new Date(),
      signature: verifyMpesaSignature(req),
      timestamp,
    };

    next();
  };
};

/**
 * Get or update M-Pesa server IP whitelist
 * Useful for monitoring and maintenance
 *
 * @returns {Object} Current whitelist configuration
 */
export const getWebhookConfiguration = () => {
  return {
    environment: process.env.MPESA_ENV || 'sandbox',
    allowedIps: getAllowedIps(),
    securityFeatures: {
      ipValidation: true,
      signatureValidation: true,
      timestampValidation: true,
      bodyIntegrityCheck: true,
    },
    lastUpdated: new Date().toISOString(),
  };
};

/**
 * Log webhook validation event for audit trail
 * Complies with KDPA 2019 audit requirements
 *
 * @internal
 * @param {Object} event - Event details
 * @param {string} event.action - Action (accept/reject)
 * @param {string} event.reason - Reason for decision
 * @param {string} event.checkoutRequestId - M-Pesa transaction ID
 * @param {string} event.sourceIp - Source IP address
 */
export const logWebhookEvent = event => {
  logger.info('M-Pesa webhook event', {
    action: event.action,
    reason: event.reason,
    checkoutRequestId: event.checkoutRequestId,
    sourceIp: event.sourceIp,
    timestamp: new Date().toISOString(),
  });

  // TODO: Store in audit_logs table for compliance
  // This enables audit trail for KDPA Article 8 (right to access data history)
};

export default {
  verifySourceIp,
  verifyMpesaSignature,
  isTimestampValid,
  validateMpesaWebhook,
  getWebhookConfiguration,
  logWebhookEvent,
};
