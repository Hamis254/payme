import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  paymeSchema,
  validateCartSchema,
} from '#validations/payme.validation.js';
import {
  validateAndCalculateCart,
  createSale,
  getSalesForBusiness,
  getSaleById,
} from '#services/sales.service.js';
import { getPaymentConfig } from '#services/paymentConfig.service.js';
import { initiateBusinessPayment } from '#utils/mpesa.js';
import { db } from '#config/database.js';
import { sales } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { eq } from 'drizzle-orm';

// Preview cart totals before payment
export const previewCart = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = validateCartSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { business_id, items } = validationResult.data;

    const cart = await validateAndCalculateCart(
      req.user.id,
      business_id,
      items
    );

    res.status(200).json({
      message: 'Cart validated successfully',
      business_name: cart.business.name,
      items: cart.items,
      total_amount: cart.total_amount,
      items_count: cart.items_count,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    if (e.message.includes('Product') && e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }
    if (e.message.includes('Insufficient stock')) {
      return res.status(400).json({ error: e.message });
    }
    logger.error('Error previewing cart', e);
    next(e);
  }
};

// Main PayMe endpoint - process sale with immediate M-Pesa STK if needed
export const processPayMe = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = paymeSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const {
      business_id,
      items,
      payment_mode,
      customer_phone,
      customer_type,
      note,
    } = validationResult.data;

    // For M-Pesa, validate payment config EXISTS before creating sale
    if (payment_mode === 'mpesa') {
      if (!customer_phone) {
        return res.status(400).json({
          error: 'Customer phone number is required for M-Pesa payment',
        });
      }

      const paymentConfig = await getPaymentConfig(business_id);
      if (!paymentConfig) {
        return res.status(400).json({
          error: 'Payment configuration not found',
          hint: 'Please setup your M-Pesa payment method first',
          setupUrl: '/api/payment-config/setup',
        });
      }
      if (!paymentConfig.is_active) {
        return res.status(400).json({
          error: 'Payment configuration is inactive',
          hint: 'Please activate or reconfigure your M-Pesa credentials',
        });
      }
    }

    // Create the sale
    const result = await createSale(
      req.user.id,
      business_id,
      items,
      payment_mode,
      {
        customer_phone,
        customer_type,
        note,
      }
    );

    // Build response
    const response = {
      message:
        payment_mode === 'cash'
          ? 'Sale completed successfully'
          : 'Sale created, initiating M-Pesa payment',
      sale: result.sale,
      items: result.items,
      summary: result.summary,
    };

    // If M-Pesa, immediately initiate STK push
    if (payment_mode === 'mpesa') {
      try {
        const paymentConfig = await getPaymentConfig(business_id);

        const mpesaResp = await initiateBusinessPayment({
          paymentConfig,
          phone: customer_phone,
          amount: result.summary.total_amount,
          description: `PAYME Sale #${result.sale.id}`,
        });

        // Store payment initiation
        await db.insert(payments).values({
          sale_id: result.sale.id,
          stk_request_id: mpesaResp.CheckoutRequestID || null,
          phone: customer_phone,
          amount: result.summary.total_amount,
          status: 'initiated',
          callback_payload: JSON.stringify(mpesaResp),
          created_at: new Date(),
        });

        // Update sale with STK request ID
        await db
          .update(sales)
          .set({
            stk_request_id: mpesaResp.CheckoutRequestID || null,
            payment_status: 'initiated',
            updated_at: new Date(),
          })
          .where(eq(sales.id, result.sale.id));

        response.mpesa = {
          status: 'initiated',
          checkoutRequestId: mpesaResp.CheckoutRequestID,
          customer_message: mpesaResp.CustomerMessage || 'Enter MPESA PIN on your phone to complete payment',
          amount: result.summary.total_amount,
        };

        logger.info(`M-Pesa STK initiated for PayMe sale ${result.sale.id}`, {
          checkoutRequestId: mpesaResp.CheckoutRequestID,
          amount: result.summary.total_amount,
        });
      } catch (mpesaError) {
        logger.error('Failed to initiate M-Pesa for PayMe', mpesaError);
        return res.status(400).json({
          error: 'Failed to initiate payment',
          message: mpesaError.message,
        });
      }
    }

    logger.info(
      `PayMe processed: ${payment_mode} sale for business ${business_id}, total: ${result.summary.total_amount}`
    );

    res.status(201).json(response);
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    if (e.message.includes('Product') && e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }
    if (e.message.includes('Insufficient stock')) {
      return res.status(400).json({ error: e.message });
    }
    logger.error('Error processing PayMe', e);
    next(e);
  }
};

// Get sales history for a business
export const getSalesHistory = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const result = await getSalesForBusiness(req.user.id, businessId, {
      limit,
    });

    res.status(200).json({
      message: 'Sales history retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error getting sales history', e);
    next(e);
  }
};

// Get single sale details
export const getSaleDetails = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId) || saleId <= 0) {
      return res.status(400).json({ error: 'Invalid sale id' });
    }

    const result = await getSaleById(req.user.id, saleId);

    res.status(200).json({
      message: 'Sale details retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (
      e.message === 'Sale not found' ||
      e.message === 'Sale not found or access denied'
    ) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    logger.error('Error getting sale details', e);
    next(e);
  }
};
