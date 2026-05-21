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
import { createCreditSale } from '#services/credit.service.js';
import { createAgreement } from '#services/higherPurchase.service.js';
import { createRecord } from '#services/record.service.js';
import { db } from '#config/database.js';
import { sales } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { eq } from 'drizzle-orm';

// ─────────────────────────────────────────────
// PREVIEW CART
// POST /api/payme/preview
// Validates items and returns totals before payment — no sale created
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// PROCESS PAYME
// POST /api/payme/
// Sole entry point for all sale creation.
// Handles cash, M-Pesa, credit, and hire purchase.
// ─────────────────────────────────────────────

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
      // Credit fields
      credit_account_id,
      credit_due_date,
      // Hire Purchase fields
      hp_account_id,
      hp_interest_rate,
      hp_down_payment,
      hp_installment_amount,
      hp_installment_frequency,
      hp_number_of_installments,
      hp_first_payment_date,
    } = validationResult.data;

    // For M-Pesa, validate payment config EXISTS before creating a sale
    if (payment_mode === 'mpesa') {
      const paymentConfig = await getPaymentConfig(business_id);
      if (!paymentConfig) {
        return res.status(400).json({
          error: 'Payment configuration not found',
          hint: 'Please setup your M-Pesa payment method first',
          setup_url: '/api/payment-config/fields?method=paybill',
        });
      }
      if (!paymentConfig.is_active) {
        return res.status(400).json({
          error: 'Payment configuration is inactive',
          hint: 'Please activate or reconfigure your M-Pesa credentials in Settings',
        });
      }
    }

    // Create the core sale record
    const result = await createSale(
      req.user.id,
      business_id,
      items,
      payment_mode,
      { customer_phone, customer_type, note }
    );

    const response = {
      message:
        payment_mode === 'cash'
          ? 'Sale completed successfully'
          : payment_mode === 'mpesa'
            ? 'Sale created, initiating M-Pesa payment'
            : payment_mode === 'credit'
              ? 'Credit sale recorded'
              : 'Hire purchase agreement created',
      sale: result.sale,
      items: result.items,
      summary: result.summary,
    };

    // ══════════════════════════════════════════
    // CASH — write ledger record immediately
    // ══════════════════════════════════════════
    if (payment_mode === 'cash') {
      try {
        await createRecord({
          business_id,
          user_id: req.user.id,
          type: 'sales',
          category: 'cash',
          amount: result.summary.total_amount,
          payment_method: 'cash',
          transaction_date: new Date(),
          reference_id: String(result.sale.id),
          description: `Cash sale #${result.sale.id}`,
          items: result.items.map(item => ({
            item_name: item.product_name || `Product #${item.product_id}`,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            product_id: item.product_id,
            cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
          })),
        });
      } catch (recordError) {
        logger.error('Failed to write cash sale to ledger', {
          sale_id: result.sale.id,
          error: recordError.message,
        });
        // Non-fatal
      }
    }

    // ══════════════════════════════════════════
    // M-PESA — initiate STK push
    // Record/token deduction happens in callback after resultCode === 0
    // ══════════════════════════════════════════
    if (payment_mode === 'mpesa') {
      try {
        const paymentConfig = await getPaymentConfig(business_id);

        const mpesaResp = await initiateBusinessPayment({
          paymentConfig,
          phone: customer_phone,
          amount: result.summary.total_amount,
          description: `PAYME Sale #${result.sale.id}`,
        });

        // Store payment initiation record
        await db.insert(payments).values({
          sale_id: result.sale.id,
          stk_request_id: mpesaResp.CheckoutRequestID || null,
          phone: customer_phone,
          amount: String(result.summary.total_amount),
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
          customer_message:
            mpesaResp.CustomerMessage ||
            'Enter MPESA PIN on your phone to complete payment',
          amount: result.summary.total_amount,
        };

        logger.info(`M-Pesa STK initiated for PayMe sale ${result.sale.id}`, {
          checkoutRequestId: mpesaResp.CheckoutRequestID,
          amount: result.summary.total_amount,
        });
      } catch (mpesaError) {
        logger.error('Failed to initiate M-Pesa for PayMe', mpesaError);
        return res.status(400).json({
          error: 'Failed to initiate M-Pesa payment',
          message: mpesaError.message,
        });
      }
    }

    // ══════════════════════════════════════════
    // CREDIT SALE
    // ══════════════════════════════════════════
    if (payment_mode === 'credit') {
      try {
        await createCreditSale(
          req.user.id,
          business_id,
          credit_account_id,
          result.summary.total_amount,
          credit_due_date,
          result.items
        );

        await createRecord({
          business_id,
          user_id: req.user.id,
          type: 'credit',
          category: 'credit_sale',
          amount: result.summary.total_amount,
          payment_method: 'credit',
          transaction_date: new Date(),
          reference_id: String(result.sale.id),
          description: `Credit sale #${result.sale.id}`,
          credit_due_date,
          items: result.items.map(item => ({
            item_name: item.product_name || `Product #${item.product_id}`,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            product_id: item.product_id,
            cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
          })),
        });

        response.credit = {
          status: 'recorded',
          account_id: credit_account_id,
          due_date: credit_due_date,
          amount_due: result.summary.total_amount,
        };
      } catch (creditError) {
        logger.error('Credit sale processing failed', creditError);
        return res.status(400).json({
          error: 'Credit sale failed',
          message: creditError.message,
        });
      }
    }

    // ══════════════════════════════════════════
    // HIRE PURCHASE
    // ══════════════════════════════════════════
    if (payment_mode === 'hire_purchase') {
      try {
        const totalAmount = result.summary.total_amount;

        // Calculate final payment date from frequency + number of installments
        const finalPaymentDate = new Date(hp_first_payment_date);
        if (hp_installment_frequency === 'monthly') {
          finalPaymentDate.setMonth(
            finalPaymentDate.getMonth() + hp_number_of_installments - 1
          );
        } else if (hp_installment_frequency === 'weekly') {
          finalPaymentDate.setDate(
            finalPaymentDate.getDate() + (hp_number_of_installments - 1) * 7
          );
        } else if (hp_installment_frequency === 'bi-weekly') {
          finalPaymentDate.setDate(
            finalPaymentDate.getDate() + (hp_number_of_installments - 1) * 14
          );
        } else if (hp_installment_frequency === 'daily') {
          finalPaymentDate.setDate(
            finalPaymentDate.getDate() + hp_number_of_installments - 1
          );
        }

        const agreement = await createAgreement({
          saleId: result.sale.id,
          accountId: hp_account_id,
          businessId: business_id,
          principalAmount: totalAmount,
          interestRate: hp_interest_rate,
          downPayment: hp_down_payment,
          installmentAmount: hp_installment_amount,
          installmentFrequency: hp_installment_frequency,
          numberOfInstallments: hp_number_of_installments,
          agreementDate: new Date(),
          firstPaymentDate: hp_first_payment_date,
          finalPaymentDate,
          lateFeeAmount: 0,
          gracePeriodDays: 3,
          createdBy: req.user.id,
        });

        await createRecord({
          business_id,
          user_id: req.user.id,
          type: 'hp',
          category: 'hire_purchase',
          amount: totalAmount,
          payment_method: 'hire_purchase',
          transaction_date: new Date(),
          reference_id: String(result.sale.id),
          description: `HP sale #${result.sale.id} — ${hp_number_of_installments} installments`,
          items: result.items.map(item => ({
            item_name: item.product_name || `Product #${item.product_id}`,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            product_id: item.product_id,
            cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
          })),
        });

        response.hire_purchase = {
          status: 'agreement_created',
          agreement_id: agreement.agreement?.id,
          installments: hp_number_of_installments,
          installment_amount: hp_installment_amount,
          frequency: hp_installment_frequency,
          first_payment_date: hp_first_payment_date,
        };
      } catch (hpError) {
        logger.error('Hire purchase processing failed', hpError);
        return res.status(400).json({
          error: 'Hire purchase failed',
          message: hpError.message,
        });
      }
    }

    logger.info(
      `PayMe processed: ${payment_mode} sale #${result.sale.id} — business ${business_id}, total: ${result.summary.total_amount}`
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

// ─────────────────────────────────────────────
// GET SALES HISTORY
// GET /api/payme/sales/business/:businessId
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// GET SINGLE SALE DETAILS
// GET /api/payme/sales/:id
// ─────────────────────────────────────────────

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
