/**
 * Encryption Utility for PayMe
 * Handles encryption and decryption of sensitive data at rest
 * Uses AES-256-GCM for authenticated encryption with Galois/Counter Mode
 *
 * Supported Fields:
 * - phone_number (user identification)
 * - id_number (compliance/KYC)
 * - mpesa_sender_phone (payment verification)
 * - Any custom sensitive field
 *
 * Kenya Data Protection Act 2019 Compliance:
 * - Personal data must be encrypted
 * - Audit logs of access maintained
 * - User has right to data deletion
 */

import crypto from 'crypto';
import logger from '#config/logger.js';

// Validate encryption key is configured
if (!process.env.ENCRYPTION_KEY) {
  throw new Error(
    'ENCRYPTION_KEY not found in environment variables. ' +
      'Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
  );
}

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

// Validate key length
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error(
    'ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
      'Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
  );
}

/**
 * Encrypt sensitive data
 * Format: `encryptedData.iv.authTag` (all base64 encoded)
 *
 * @param {string} plaintext - Data to encrypt
 * @param {string} additionalData - AAD for authentication (e.g., userId, fieldName)
 * @returns {string} Encrypted string in format: `encryptedData.iv.authTag`
 * @throws {Error} If encryption fails
 *
 * @example
 * const encrypted = encrypt('+254712345678', 'user_123.phone_number');
 * // Returns: 'xB9k2...{base64}.iv=aB3f....{base64}.tag=Ct7X...{base64}'
 */
export const encrypt = (plaintext, additionalData = '') => {
  try {
    // Generate random IV for this encryption
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher with key and IV
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

    // Set additional authenticated data (AAD)
    // AAD is not encrypted but is authenticated, preventing tampering
    if (additionalData) {
      cipher.setAAD(Buffer.from(additionalData, 'utf8'));
    }

    // Encrypt the plaintext
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Return: encrypted.iv.authTag (all base64 encoded)
    return `${encrypted.toString('base64')}.${iv.toString('base64')}.${authTag.toString('base64')}`;
  } catch (error) {
    logger.error('Encryption failed', {
      error: error.message,
      fieldSize: plaintext?.length || 0,
    });
    throw new Error(`Encryption failed: ${error.message}`);
  }
};

/**
 * Decrypt sensitive data
 * Reverses the encryption process and verifies authenticity
 *
 * @param {string} encryptedString - Data in format: `encryptedData.iv.authTag`
 * @param {string} additionalData - AAD for authentication (must match encryption)
 * @returns {string} Original plaintext
 * @throws {Error} If decryption or authentication fails
 *
 * @example
 * const phone = decrypt(encrypted, 'user_123.phone_number');
 * // Returns: '+254712345678'
 */
export const decrypt = (encryptedString, additionalData = '') => {
  try {
    // Parse the encrypted string format: encryptedData.iv.authTag
    const parts = encryptedString.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const encrypted = Buffer.from(parts[0], 'base64');
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');

    // Validate IV and authTag lengths
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: ${iv.length}`);
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length: ${authTag.length}`);
    }

    // Create decipher with key and IV
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

    // Set the authentication tag for verification
    decipher.setAuthTag(authTag);

    // Set AAD (must match encryption)
    if (additionalData) {
      decipher.setAAD(Buffer.from(additionalData, 'utf8'));
    }

    // Decrypt and verify
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    // Authentication failed or corruption detected
    logger.error('Decryption failed - possible data tampering or auth failure', {
      error: error.message,
      dataLength: encryptedString?.length || 0,
    });
    throw new Error(`Decryption failed: ${error.message}`);
  }
};

/**
 * Batch encrypt multiple fields in an object
 * Useful for encrypting user records with multiple sensitive fields
 *
 * @param {Object} data - Object containing sensitive data
 * @param {string[]} fields - List of field names to encrypt
 * @param {string} context - Additional context for AAD (e.g., userId)
 * @returns {Object} New object with encrypted fields
 *
 * @example
 * const user = { name: 'John', phone_number: '+254712345678', id_number: '1234567890' };
 * const encrypted = encryptFields(user, ['phone_number', 'id_number'], 'user_123');
 * // Returns: { name: 'John', phone_number: 'encrypted...', id_number: 'encrypted...' }
 */
export const encryptFields = (data, fields, context = '') => {
  const result = { ...data };

  for (const field of fields) {
    if (result[field]) {
      result[field] = encrypt(
        result[field],
        `${context}.${field}`
      );
    }
  }

  return result;
};

/**
 * Batch decrypt multiple fields in an object
 *
 * @param {Object} data - Object containing encrypted data
 * @param {string[]} fields - List of field names to decrypt
 * @param {string} context - Additional context for AAD (must match encryption)
 * @returns {Object} New object with decrypted fields
 */
export const decryptFields = (data, fields, context = '') => {
  const result = { ...data };

  for (const field of fields) {
    if (result[field]) {
      result[field] = decrypt(
        result[field],
        `${context}.${field}`
      );
    }
  }

  return result;
};

/**
 * Check if a string is encrypted (has the format encryptedData.iv.authTag)
 *
 * @param {string} str - String to check
 * @returns {boolean} True if string matches encrypted format
 */
export const isEncrypted = str => {
  if (typeof str !== 'string') return false;
  const parts = str.split('.');
  return parts.length === 3;
};

/**
 * Generate encryption key for environment setup
 * Call this once and store in .env as ENCRYPTION_KEY
 *
 * @returns {string} 64-character hex string (32 bytes for AES-256)
 */
export const generateEncryptionKey = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Audit log encryption/decryption access
 * For compliance with KDPA 2019 data access tracking
 *
 * @param {string} action - 'encrypt' or 'decrypt'
 * @param {string} field - Field being encrypted/decrypted
 * @param {string} userId - User ID accessing the data
 * @param {string} reason - Why the data is being accessed
 * @internal
 */
export const logEncryptionAccess = (action, field, userId, reason = '') => {
  logger.info('Encryption access', {
    action,
    field,
    userId,
    reason,
    timestamp: new Date().toISOString(),
  });

  // TODO: Store in audit_logs table for compliance
  // This enables KDPA Article 8 compliance (right to access audit trails)
};

export default {
  encrypt,
  decrypt,
  encryptFields,
  decryptFields,
  isEncrypted,
  generateEncryptionKey,
  logEncryptionAccess,
};
