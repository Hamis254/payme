/**
 * Payment Configuration Service
 * Manages per-business M-Pesa payment method setup
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and } from 'drizzle-orm';
import { paymentConfigs } from '#models/paymentConfig.model.js';
import { businesses } from '#models/setting.model.js';
import axios from 'axios';
import base64 from 'base-64';

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
 * @returns {Promise<Object>} Created payment config
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

    // Create new config
    const [config] = await db
      .insert(paymentConfigs)
      .values({
        business_id: businessId,
        payment_method: paymentMethod,
        shortcode,
        passkey,
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

    return config;
  } catch (e) {
    logger.error('Error creating payment config', e);
    throw e;
  }
};

// ============ GET PAYMENT CONFIG ============

/**
 * Get active payment config for a business
 * @param {number} businessId - Business ID
 * @returns {Promise<Object|null>} Payment config or null
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

    return config || null;
  } catch (e) {
    logger.error('Error getting payment config', e);
    throw e;
  }
};

/**
 * Get payment config by ID (for admin/verification)
 * @param {number} configId - Config ID
 * @returns {Promise<Object|null>} Payment config
 */
export const getPaymentConfigById = async configId => {
  try {
    const [config] = await db
      .select()
      .from(paymentConfigs)
      .where(eq(paymentConfigs.id, configId))
      .limit(1);

    return config || null;
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
 * @returns {Promise<Object>} Updated config
 */
export const updatePaymentConfig = async (configId, updates) => {
  try {
    const [config] = await db
      .update(paymentConfigs)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(eq(paymentConfigs.id, configId))
      .returning();

    if (!config) {
      throw new Error('Payment config not found');
    }

    logger.info('Payment config updated', { configId });
    return config;
  } catch (e) {
    logger.error('Error updating payment config', e);
    throw e;
  }
};

// ============ VERIFY PAYMENT CONFIG ============


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
 * Verify payment configuration by testing credentials with M-Pesa Daraja
 * @param {number} configId - Payment config ID
 * @returns {Promise<boolean>} True if verified
 */
export const verifyPaymentConfig = async configId => {
  try {
    const config = await getPaymentConfigById(configId);

    if (!config) {
      throw new Error('Configuration not found');
    }

    // Get M-Pesa access token
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw new Error('M-Pesa OAuth credentials not configured');
    }

    const auth = base64.encode(`${consumerKey}:${consumerSecret}`);

    const tokenResponse = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 10000,
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Build test password
    const timestamp = new Date()
      .toISOString()
      .replace(/[:-]/g, '')
      .slice(0, 14);
    const password = base64.encode(
      `${config.shortcode}${config.passkey}${timestamp}`
    );

    // Test STK Push with minimal amount
    const testPayload = {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType:
        config.payment_method === 'till_number'
          ? 'CustomerBuyGoodsOnline'
          : 'CustomerPayBillOnline',
      Amount: 1, // Test with 1 KSH
      PartyA: '254712345678', // Test phone
      PartyB: config.shortcode,
      PhoneNumber: '254712345678',
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: config.account_reference,
      TransactionDesc: 'CONFIG_VERIFICATION_TEST',
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      testPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { ResponseCode } = response.data;

    if (ResponseCode === '0') {
      // ✅ Credentials are valid
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
      });
      return true;
    } else {
      throw new Error(
        `Invalid credentials: ${response.data.ResponseDescription || response.data.ResponseCode}`
      );
    }
  } catch (e) {
    logger.error('Payment config verification failed', {
      configId,
      error: e.message,
    });
    throw e;
  }
};
