import crypto from 'crypto';
import logger from '#config/logger.js';

/**
 * M-Pesa Callback Verification Utility
 * Validates callback signatures and prevents replay attacks
 */

// In production, this should come from M-Pesa API documentation
// For now, we use timestamp-based validation as a security layer
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute window

/**
 * Validate M-Pesa callback signature
 * M-Pesa uses X-Safaricom-Signature header for verification
 * (When signature is provided by M-Pesa)
 *
 * @param {string} signature - X-Safaricom-Signature header value
 * @param {string} body - Raw request body
 * @param {string} secret - M-Pesa callback secret
 * @returns {boolean} True if signature is valid
 */
export function validateCallbackSignature(signature, body, secret = null) {
  // M-Pesa signature validation (if implemented by Safaricom in future)
  if (!signature || !secret) {
    logger.debug('M-Pesa signature validation skipped (not configured)');
    return true; // Accept if not configured
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('base64');

    const isValid = signature === expectedSignature;

    if (!isValid) {
      logger.warn('M-Pesa signature validation failed', {
        expected: expectedSignature.substring(0, 10) + '...',
        received: signature.substring(0, 10) + '...',
      });
    }

    return isValid;
  } catch (error) {
    logger.error('Signature validation error', { error: error.message });
    return false;
  }
}

/**
 * Validate callback timestamp (prevent replay attacks)
 * Checks if callback was received within acceptable time window
 *
 * @param {number} callbackTimestamp - Timestamp from M-Pesa callback
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @returns {boolean} True if timestamp is within acceptable window
 */
export function validateCallbackTimestamp(
  callbackTimestamp,
  maxAgeMs = CALLBACK_TIMEOUT_MS
) {
  if (!callbackTimestamp) {
    logger.warn('Missing callback timestamp');
    return false;
  }

  const callbackTime = typeof callbackTimestamp === 'string'
    ? parseInt(callbackTimestamp, 10)
    : callbackTimestamp;

  const currentTime = Date.now();
  const age = currentTime - callbackTime;

  if (age < 0) {
    logger.warn('Callback timestamp is in the future', { age });
    return false;
  }

  if (age > maxAgeMs) {
    logger.warn('Callback timestamp is too old', {
      ageSeconds: (age / 1000).toFixed(2),
      maxAgeSeconds: (maxAgeMs / 1000).toFixed(2),
    });
    return false;
  }

  return true;
}

/**
 * Validate M-Pesa callback structure
 * Ensures required fields are present
 *
 * @param {Object} callbackBody - M-Pesa callback body
 * @returns {Object} Validation result { valid, errors }
 */
export function validateCallbackStructure(callbackBody) {
  const errors = [];

  if (!callbackBody) {
    errors.push('Callback body is missing');
    return { valid: false, errors };
  }

  if (!callbackBody.Body) {
    errors.push('Missing Body field');
  }

  if (!callbackBody.Body?.stkCallback) {
    errors.push('Missing stkCallback field');
  }

  const stkCallback = callbackBody.Body?.stkCallback || {};

  if (!stkCallback.CheckoutRequestID) {
    errors.push('Missing CheckoutRequestID');
  }

  if (stkCallback.ResultCode === undefined) {
    errors.push('Missing ResultCode');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize callback data to prevent injection attacks
 * Removes/escapes potentially dangerous data
 *
 * @param {Object} callbackData - Raw callback data
 * @returns {Object} Sanitized callback data
 */
export function sanitizeCallbackData(callbackData) {
  const sanitized = JSON.parse(JSON.stringify(callbackData)); // Deep copy

  // Sanitize string fields
  const stringFields = [
    'Body.stkCallback.CheckoutRequestID',
    'Body.stkCallback.MerchantRequestID',
    'Body.stkCallback.ResultDesc',
  ];

  stringFields.forEach(path => {
    const keys = path.split('.');
    let current = sanitized;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) return;
      current = current[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    if (typeof current[lastKey] === 'string') {
      // Remove control characters and normalize whitespace
      // eslint-disable-next-line no-control-regex
      current[lastKey] = current[lastKey].replace(/[\u0000-\u001F\u007F]/g, '').trim();
    }
  });

  return sanitized;
}

/**
 * Extract M-Pesa metadata from callback
 * Safely extract amount, receipt, phone from callback metadata array
 *
 * @param {Array} items - CallbackMetadata.Item array
 * @returns {Object} Extracted metadata with safe defaults
 */
export function extractCallbackMetadata(items) {
  if (!Array.isArray(items)) {
    return {
      amount: null,
      mpesaReceiptNumber: null,
      phoneNumber: null,
      transactionDate: null,
      transactionTimestamp: null,
    };
  }

  const metadata = {};

  items.forEach(item => {
    // eslint-disable-next-line no-prototype-builtins
    if (!item.Name || !item.hasOwnProperty('Value')) return;

    const name = item.Name.trim();
    const value = String(item.Value || '').trim();

    switch (name) {
      case 'Amount':
        metadata.amount = parseFloat(value);
        break;
      case 'MpesaReceiptNumber':
        metadata.mpesaReceiptNumber = value;
        break;
      case 'PhoneNumber':
        metadata.phoneNumber = value;
        break;
      case 'TransactionDate':
        metadata.transactionDate = value;
        metadata.transactionTimestamp = parseInt(value, 10);
        break;
      default:
        break;
    }
  });

  return {
    amount: metadata.amount || null,
    mpesaReceiptNumber: metadata.mpesaReceiptNumber || null,
    phoneNumber: metadata.phoneNumber || null,
    transactionDate: metadata.transactionDate || null,
    transactionTimestamp: metadata.transactionTimestamp || null,
  };
}

/**
 * Comprehensive callback validation
 * Combines all validation checks
 *
 * @param {Object} callbackData - Raw callback data
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateCallback(callbackData, options = {}) {
  const {
    validateSignature = false,
    signature = null,
    secret = null,
    validateTimestamp = true,
  } = options;

  // Validate structure
  const structureValidation = validateCallbackStructure(callbackData);
  if (!structureValidation.valid) {
    return {
      valid: false,
      error: `Invalid callback structure: ${structureValidation.errors.join(', ')}`,
      errors: structureValidation.errors,
    };
  }

  // Validate signature if enabled
  if (validateSignature) {
    const bodyStr = JSON.stringify(callbackData);
    if (!validateCallbackSignature(signature, bodyStr, secret)) {
      return {
        valid: false,
        error: 'Invalid callback signature',
        errors: ['Signature validation failed'],
      };
    }
  }

  // Validate timestamp if enabled
  if (validateTimestamp) {
    const stkCallback = callbackData.Body?.stkCallback || {};
    const metadata = extractCallbackMetadata(stkCallback.CallbackMetadata?.Item || []);

    if (metadata.transactionTimestamp) {
      if (!validateCallbackTimestamp(metadata.transactionTimestamp)) {
        return {
          valid: false,
          error: 'Callback timestamp is outside acceptable window',
          errors: ['Timestamp validation failed'],
        };
      }
    }
  }

  return {
    valid: true,
    error: null,
    errors: [],
  };
}

export default {
  validateCallbackSignature,
  validateCallbackTimestamp,
  validateCallbackStructure,
  sanitizeCallbackData,
  extractCallbackMetadata,
  validateCallback,
};
