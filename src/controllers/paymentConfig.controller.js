/**
 * Payment Configuration Controller
 * Handles business payment method setup (paybill or till number)
 * User redirected here after signup to configure credentials
 */

import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import { setupPaymentConfigSchema, updatePaymentConfigSchema } from '#validations/paymentConfig.validation.js';
import {
  createPaymentConfig,
  getPaymentConfig,
  updatePaymentConfig,
  getPaymentConfigById,
  verifyPaymentConfig,
} from '#services/paymentConfig.service.js';

// ============ SETUP PAYMENT CONFIGURATION (Post-signup) ============

/**
 * POST /api/payment-config/setup
 * User sets up payment method after signup
 * Requires: payment_method, shortcode, passkey, account_reference
 */
export const setupPaymentMethod = async (req, res, next) => {
  try {
    const { businessId } = req.body;
    const userId = req.user?.id;

    if (!businessId || !userId) {
      return res.status(400).json({
        error: 'Missing businessId or authentication',
      });
    }

    // Validate entire request
    const validationResult = setupPaymentConfigSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const {
      payment_method,
      shortcode,
      passkey,
      account_reference,
      account_name,
    } = validationResult.data;

    // Create payment config
    const config = await createPaymentConfig({
      businessId,
      paymentMethod: payment_method,
      shortcode,
      passkey,
      accountReference: account_reference,
      accountName: account_name,
    });

    logger.info('Payment method configured', {
      configId: config.id,
      businessId,
      method: payment_method,
      userId,
    });

    res.status(201).json({
      success: true,
      message: 'Payment method configured successfully',
      config: {
        id: config.id,
        business_id: config.business_id,
        payment_method: config.payment_method,
        shortcode: config.shortcode,
        account_reference: config.account_reference,
        account_name: config.account_name,
        verified: config.verified,
        is_active: config.is_active,
      },
    });
  } catch (e) {
    logger.error('Error setting up payment method', e);

    if (e.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (e.message.includes('already exists')) {
      return res.status(409).json({
        error: 'Payment configuration already exists. Use update instead.',
      });
    }

    next(e);
  }
};

// ============ GET PAYMENT CONFIGURATION ============

/**
 * GET /api/payment-config/:businessId
 * Get current payment config for a business
 */
export const getBusinessPaymentConfig = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const userId = req.user?.id;

    if (!businessId || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const config = await getPaymentConfig(parseInt(businessId));

    if (!config) {
      return res.status(404).json({
        error: 'Payment configuration not found for this business',
      });
    }

    res.status(200).json({
      success: true,
      config: {
        id: config.id,
        business_id: config.business_id,
        payment_method: config.payment_method,
        shortcode: config.shortcode,
        account_reference: config.account_reference,
        account_name: config.account_name,
        verified: config.verified,
        is_active: config.is_active,
        created_at: config.created_at,
        updated_at: config.updated_at,
      },
    });
  } catch (e) {
    logger.error('Error fetching payment config', e);
    next(e);
  }
};

// ============ UPDATE PAYMENT CONFIGURATION ============

/**
 * PATCH /api/payment-config/:configId
 * Update existing payment configuration
 * Can update passkey, account_reference, account_name, or is_active
 */
export const updatePaymentMethod = async (req, res, next) => {
  try {
    const { configId } = req.params;
    const userId = req.user?.id;

    if (!configId || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate update data
    const validationResult = updatePaymentConfigSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    // Fetch config to verify it exists
    const config = await getPaymentConfigById(parseInt(configId));

    if (!config) {
      return res.status(404).json({ error: 'Payment configuration not found' });
    }

    // Update config
    const updated = await updatePaymentConfig(
      parseInt(configId),
      validationResult.data
    );

    logger.info('Payment config updated', {
      configId,
      userId,
    });

    res.status(200).json({
      success: true,
      message: 'Payment configuration updated',
      config: {
        id: updated.id,
        business_id: updated.business_id,
        payment_method: updated.payment_method,
        shortcode: updated.shortcode,
        account_reference: updated.account_reference,
        account_name: updated.account_name,
        verified: updated.verified,
        is_active: updated.is_active,
      },
    });
  } catch (e) {
    logger.error('Error updating payment config', e);
    next(e);
  }
};

// ============ TOGGLE PAYMENT CONFIG STATUS ============

/**
 * POST /api/payment-config/:configId/toggle
 * Enable/disable a payment configuration
 * Body: { is_active: boolean }
 */
export const togglePaymentConfig = async (req, res, next) => {
  try {
    const { configId } = req.params;
    const { is_active } = req.body;
    const userId = req.user?.id;

    if (!configId || typeof is_active !== 'boolean' || !userId) {
      return res.status(400).json({
        error: 'Missing or invalid parameters: configId and is_active boolean',
      });
    }

    const config = await getPaymentConfigById(parseInt(configId));

    if (!config) {
      return res.status(404).json({ error: 'Payment configuration not found' });
    }

    const updated = await updatePaymentConfig(parseInt(configId), {
      is_active,
    });

    logger.info('Payment config toggled', {
      configId,
      isActive: is_active,
      userId,
    });

    res.status(200).json({
      success: true,
      message: `Payment configuration ${is_active ? 'activated' : 'deactivated'}`,
      config: {
        id: updated.id,
        is_active: updated.is_active,
        payment_method: updated.payment_method,
      },
    });
  } catch (e) {
    logger.error('Error toggling payment config', e);
    next(e);
  }
};

// ============ VERIFY PAYMENT CONFIG ============

/**
 * POST /api/payment-config/:configId/verify
 * Verify payment configuration credentials with M-Pesa Daraja
 * Tests if credentials are valid by attempting a test STK push
 */
export const verifyPaymentConfigHandler = async (req, res, _next) => {
  try {
    const { configId } = req.params;
    const userId = req.user?.id;

    if (!configId || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const config = await getPaymentConfigById(parseInt(configId));

    if (!config) {
      return res.status(404).json({ error: 'Payment configuration not found' });
    }

    // Verify config with M-Pesa Daraja
    await verifyPaymentConfig(parseInt(configId));

    logger.info('Payment config verified successfully', {
      configId,
      method: config.payment_method,
      userId,
    });

    res.status(200).json({
      success: true,
      message: 'Payment configuration verified successfully',
      config: {
        id: config.id,
        verified: true,
        payment_method: config.payment_method,
        shortcode: config.shortcode,
        account_reference: config.account_reference,
      },
    });
  } catch (e) {
    logger.error('Error verifying payment config', {
      configId: req.params.id,
      error: e.message,
    });

    if (e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }

    if (e.message.includes('credentials') || e.message.includes('Invalid')) {
      return res.status(400).json({
        error: 'Invalid M-Pesa credentials',
        message: 'Your M-Pesa credentials could not be verified with Safaricom. Please check and reconfigure.',
      });
    }

    if (e.message.includes('Configuration')) {
      return res.status(400).json({
        error: 'Invalid or incomplete configuration',
        message: e.message,
      });
    }

    res.status(500).json({
      error: 'Verification failed',
      message: e.message,
    });
  }
};
