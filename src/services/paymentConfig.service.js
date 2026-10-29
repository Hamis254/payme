/**
 * Payment Configuration Service
 * Manages per-business M-Pesa payment method setup
 *
 * SECURITY FIX (added)
 * ─────────────────────
 * `passkey` is a Daraja credential — previously stored in plaintext even
 * though the model comment claimed "encrypted at rest". It's now encrypted
 * with the existing AES-256-GCM utility (#utils/encryption.js) before being
 * written, and transparently decrypted whenever a config is read, so every
 * other part of the app (mpesa.js, payme.controller.js) keeps working with
 * the plaintext value exactly as before — nothing downstream needs to change.
 *
 * ENVIRONMENT FIX (added)
 * ─────────────────────────
 * `verifyPaymentConfig` uses the shared STK push helper so verification
 * follows the same environment, callback, and timestamp behavior as payments.
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and } from 'drizzle-orm';
import { paymentConfigs } from '#models/paymentConfig.model.js';
import { businesses } from '#models/setting.model.js';
import { encrypt, decrypt, isEncrypted } from '#utils/encryption.js';
import { initiateBusinessPayment } from '#utils/mpesa.js';

const normalizePaymentMethod = method => {
  if (method === 'till') return 'till_number';
  return method;
};

/**
 * Decrypt the passkey on a config row before returning it to callers.
 * Safe to call on rows written before encryption was added — isEncrypted()
 * detects the old plaintext rows and returns them unchanged instead of
 * throwing, so nothing breaks for configs that predate this fix.
 */
const withDecryptedPasskey = config => {
  if (!config) return config;
  if (config.passkey && isEncrypted(config.passkey)) {
    // Try the business-scoped AAD first (used when creating configs),
    // then fall back to the per-config-id AAD for older rows.
    const businessAAD = `payment_config.business_${config.business_id}.passkey`;
    const configIdAAD = `payment_config.${config.id}.passkey`;

    try {
      return {
        ...config,
        passkey: decrypt(config.passkey, businessAAD),
      };
    } catch (e1) {
      try {
        return {
          ...config,
          passkey: decrypt(config.passkey, configIdAAD),
        };
      } catch {
        // Re-throw the original error to preserve context
        throw e1;
      }
    }
  }
  return config;
};

// ============ SETUP & CREATE PAYMENT CONFIG ============

/**
 * Create payment configuration for a business
 * Called after user signs up and needs to setup payment method
 * @param {Object} params - Configuration parameters
 * @param {number} params.businessId - Business ID
 * @param {string} params.paymentMethod - 'till' or 'paybill'
 * @param {string} params.shortcode - M-Pesa shortcode/till/paybill
 * @param {string} params.passkey - Daraja passkey
 * @param {string} params.accountReference - Account reference (max 12 chars)
 * @param {string} [params.accountName] - Optional account display name
 * @returns {Promise<Object>} Created payment config (with plaintext passkey)
 */
export const createPaymentConfig = async ({
  businessId,
  paymentMethod,
  shortcode,
  passkey,
  accountReference,
  accountName,
}) => {
  try {
    // Verify business exists
    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);

    if (!business) {
      throw new Error('Business not found');
    }

    // Check if config already exists for this business
    const [existing] = await db
      .select()
      .from(paymentConfigs)
      .where(eq(paymentConfigs.business_id, businessId))
      .limit(1);

    if (existing) {
      throw new Error(
        'Payment configuration already exists. Use update instead.'
      );
    }

    // Create new config — passkey encrypted at rest.
    // AAD is bound to businessId so a row can't be decrypted if ever
    // copied/moved to a different business record.
    const [config] = await db
      .insert(paymentConfigs)
      .values({
        business_id: businessId,
        payment_method: normalizePaymentMethod(paymentMethod),
        shortcode,
        passkey: encrypt(passkey, `payment_config.business_${businessId}.passkey`),
        account_reference: accountReference,
        account_name: accountName || null,
        verified: false,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    logger.info('Payment config created', {
      configId: config.id,
      businessId,
      method: paymentMethod,
    });

    // Return with the plaintext passkey the caller just supplied — no need
    // to decrypt what we already have in memory.
    return { ...config, passkey };
  } catch (e) {
    logger.error('Error creating payment config', e);
    throw e;
  }
};

// ============ GET PAYMENT CONFIG ============

/**
 * Get active payment config for a business
 * @param {number} businessId - Business ID
 * @returns {Promise<Object|null>} Payment config (passkey decrypted) or null
 */
export const getPaymentConfig = async businessId => {
  try {
    const [config] = await db
      .select()
      .from(paymentConfigs)
      .where(
        and(
          eq(paymentConfigs.business_id, businessId),
          eq(paymentConfigs.is_active, true)
        )
      )
      .limit(1);

    return withDecryptedPasskey(config) || null;
  } catch (e) {
    logger.error('Error getting payment config', e);
    throw e;
  }
};

/**
 * Get payment config by ID (for admin/verification)
 * @param {number} configId - Config ID
 * @returns {Promise<Object|null>} Payment config (passkey decrypted)
 */
export const getPaymentConfigById = async configId => {
  try {
    const [config] = await db
      .select()
      .from(paymentConfigs)
      .where(eq(paymentConfigs.id, configId))
      .limit(1);

    return withDecryptedPasskey(config) || null;
  } catch (e) {
    logger.error('Error fetching payment config by ID', e);
    throw e;
  }
};

// ============ UPDATE PAYMENT CONFIG ============

/**
 * Update payment configuration for a business
 * @param {number} configId - Config ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated config (passkey decrypted)
 */
export const updatePaymentConfig = async (configId, updates) => {
  try {
    const normalizedUpdates = {
      ...updates,
      payment_method: updates.payment_method
        ? normalizePaymentMethod(updates.payment_method)
        : updates.payment_method,
    };

    // Encrypt passkey if it's being updated — never write it in plaintext.
    if (normalizedUpdates.passkey) {
      // Fetch existing config to get the business_id so we can bind AAD
      // to the business scope (same pattern used on create).
      const [existing] = await db
        .select()
        .from(paymentConfigs)
        .where(eq(paymentConfigs.id, configId))
        .limit(1);

      if (!existing) {
        throw new Error('Payment config not found');
      }

      normalizedUpdates.passkey = encrypt(
        normalizedUpdates.passkey,
        `payment_config.business_${existing.business_id}.passkey`
      );
    }

    const [config] = await db
      .update(paymentConfigs)
      .set({
        ...normalizedUpdates,
        updated_at: new Date(),
      })
      .where(eq(paymentConfigs.id, configId))
      .returning();

    if (!config) {
      throw new Error('Payment config not found');
    }

    logger.info('Payment config updated', { configId });
    return withDecryptedPasskey(config);
  } catch (e) {
    logger.error('Error updating payment config', e);
    throw e;
  }
};

// ============ TOGGLE PAYMENT CONFIG STATUS ============

/**
 * Activate or deactivate a payment configuration
 * @param {number} configId - Config ID
 * @param {boolean} isActive - Active status
 * @returns {Promise<Object>} Updated config
 */
export const togglePaymentConfig = async (configId, isActive) => {
  try {
    return await updatePaymentConfig(configId, {
      is_active: isActive,
    });
  } catch (e) {
    logger.error('Error toggling payment config', e);
    throw e;
  }
};

// ============ DELETE PAYMENT CONFIG ============

/**
 * Delete payment configuration
 * Soft delete by setting is_active to false
 * @param {number} configId - Config ID
 * @returns {Promise<void>}
 */
export const deletePaymentConfig = async configId => {
  try {
    await updatePaymentConfig(configId, {
      is_active: false,
    });

    logger.info('Payment config deleted', { configId });
  } catch (e) {
    logger.error('Error deleting payment config', e);
    throw e;
  }
};

// ============ VERIFY PAYMENT CONFIG ============

/**
 * Verify payment configuration by testing credentials with M-Pesa Daraja.
 *
 * @param {number} configId - Payment config ID
 * @param {string} [testPhoneNumber] - Phone to send the test STK push to.
 *   In sandbox, use Safaricom's shared test number (254708374149).
 *   In production, this MUST be a real phone (e.g. the business owner's
 *   own number) since production STK pushes go to real subscribers —
 *   there is no "free" way to verify a live shortcode/passkey pair
 *   without prompting an actual phone. If omitted, falls back to
 *   MPESA_TEST_PHONE from env (sandbox use only).
 * @returns {Promise<boolean>} True if verified
 */
export const verifyPaymentConfig = async (configId, testPhoneNumber = null) => {
  try {
    const config = await getPaymentConfigById(configId);

    if (!config) {
      throw new Error('Configuration not found');
    }

    const phoneForTest = testPhoneNumber || process.env.MPESA_TEST_PHONE;

    if (!phoneForTest) {
      throw new Error(
        'No test phone number provided. Pass testPhoneNumber, or set ' +
          'MPESA_TEST_PHONE in .env for sandbox testing.'
      );
    }

    await initiateBusinessPayment({
      paymentConfig: config,
      phone: phoneForTest,
      amount: 1,
      description: 'CONFIG_VERIFICATION_TEST',
    });

    await db
      .update(paymentConfigs)
      .set({
        verified: true,
        updated_at: new Date(),
      })
      .where(eq(paymentConfigs.id, configId));

    logger.info('Payment config verified successfully', {
      configId,
      method: config.payment_method,
      env: process.env.MPESA_ENV || 'sandbox',
    });
    return true;
  } catch (e) {
    logger.error('Payment config verification failed', {
      configId,
      error: e.message,
    });
    throw e;
  }
};