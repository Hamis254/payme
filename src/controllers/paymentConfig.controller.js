/**
 * Payment Configuration Controller
 * Handles business payment method setup (paybill or till number)
 * User redirected here after signup to configure credentials
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { and, eq } from 'drizzle-orm';
import { formatValidationError } from '#utils/format.js';
import {
  setupPaymentConfigSchema,
  updatePaymentConfigSchema,
  getPaymentConfigFields,
} from '#validations/paymentConfig.validation.js';
import {
  createPaymentConfig,
  getPaymentConfig,
  updatePaymentConfig,
  getPaymentConfigById,
  verifyPaymentConfig,
} from '#services/paymentConfig.service.js';

const assertBusinessOwnership = async (businessId, userId) => {
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) {
    throw new Error('Business not found or access denied');
  }
};

// ============ FIELD GUIDANCE (for frontend form rendering) ============

/**
 * GET /api/payment-config/fields?method=paybill|till
 *
 * This was imported by paymentConfig.routes.js but never implemented —
 * the underlying field-description logic already existed in
 * getPaymentConfigFields() (paymentConfig.validation.js), it just had no
 * controller wired up to it. This is that wiring.
 *
 * Returns which fields the frontend needs to collect for the given payment
 * method, with labels/hints/required flags — lets a form like your
 * FlutterFlow "Payment Setup" screen render the right fields without
 * hardcoding them client-side.
 */
export const getPaymentConfigHandler = (req, res) => {
  const rawMethod = req.query.method;

  // Accept both 'till' (as documented in the route comment) and
  // 'till_number' (the value actually stored/used elsewhere in the app).
  const method = rawMethod === 'till' ? 'till_number' : rawMethod;

  if (method !== 'paybill' && method !== 'till_number') {
    return res.status(400).json({
      error: 'Invalid or missing method',
      message: "Query param 'method' must be 'paybill' or 'till'",
    });
  }

  return res.status(200).json({
    payment_method: method,
    fields: getPaymentConfigFields(method),
  });
};

// ============ SETUP PAYMENT CONFIGURATION (Post-signup) ============

/**
 * POST /api/payment-config/setup
 * User sets up payment method after signup
 * Requires: payment_method, shortcode, passkey, account_reference
 */
export const setupPaymentMethod = async (req, res, next) => {
  try {
    // Accept business_id (the convention used by every other field/endpoint
    // in this API — payment_method, account_reference, etc. are all
    // snake_case, and the DB column itself is business_id) while still
    // accepting businessId in case any existing client already sends that.
    // Previously this ONLY read req.body.businessId, so any client sending
    // business_id (the consistent choice, matching the rest of the API)
    // would silently fail this check and get a misleading "missing
    // businessId or authentication" error even with a perfectly valid
    // auth token — the real problem was the field name, not auth.
    const businessId = req.body.business_id ?? req.body.businessId;
    const userId = req.user?.id;

    if (!businessId || !userId) {
      return res.status(400).json({
        error: 'Missing business_id or authentication',
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

    await assertBusinessOwnership(parseInt(businessId), userId);

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

    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }

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

    await assertBusinessOwnership(parseInt(businessId), userId);
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
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
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

    await assertBusinessOwnership(config.business_id, userId);

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
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
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

    await assertBusinessOwnership(config.business_id, userId);

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
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
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
    // Optional: caller can supply the phone number to send the test STK
    // push to. In production this should be the business owner's own
    // number — required since there is no free way to test a live
    // shortcode/passkey pair without prompting a real phone.
    const { phone_number: testPhoneNumber } = req.body || {};

    if (!configId || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const config = await getPaymentConfigById(parseInt(configId));

    if (!config) {
      return res.status(404).json({ error: 'Payment configuration not found' });
    }

    await assertBusinessOwnership(config.business_id, userId);

    // Verify config with M-Pesa Daraja
    await verifyPaymentConfig(parseInt(configId), testPhoneNumber);

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
        message:
          'Your M-Pesa credentials could not be verified with Safaricom. Please check and reconfigure.',
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