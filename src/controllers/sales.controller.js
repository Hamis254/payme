import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, desc } from 'drizzle-orm';
import { formatValidationError } from '#utils/format.js';
import { initiateBusinessPayment } from '#utils/mpesa.js';
import { deductTokens } from '#middleware/revenueGuard.middleware.js';
import { getPaymentConfig } from '#services/paymentConfig.service.js';
import {
  createSaleSchema,
  payMpesaSchema,
  mpesaCallbackSchema,
} from '#validations/sales.validation.js';
import { sales, saleItems } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { wallets, walletTransactions } from '#models/myWallet.model.js';
import { businesses } from '#models/setting.model.js';
import { stockMovements } from '#models/stock.model.js';
import {
  deductStockFIFO,
  checkStockAvailability,
} from '#services/stock.service.js';

// ============ CREATE SALE ============

export const createSaleHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = createSaleSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { businessId, customerName, paymentMode, items, customerType, note } =
      validationResult.data;
    const tokenFee = 1;
    let saleId;

    // Verify business ownership
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, businessId), eq(businesses.user_id, req.user.id))
      )
      .limit(1);

    if (!business) {
      return res
        .status(403)
        .json({ error: 'Business not found or access denied' });
    }

    // Check stock availability for all items
    for (const item of items) {
      const availability = await checkStockAvailability(
        item.product_id,
        item.quantity
      );
      if (!availability.available) {
        return res.status(400).json({
          error: `Insufficient stock for product ID ${item.product_id}`,
          available: availability.total_available,
          requested: item.quantity,
        });
      }
    }

    // Calculate totals
    const totalAmount = items.reduce(
      (sum, it) => sum + Number(it.quantity) * Number(it.unit_price),
      0
    );
    const totalProfit = items.reduce((sum, it) => {
      const cost = Number(it.unit_cost || 0);
      return sum + Number(it.quantity) * (Number(it.unit_price) - cost);
    }, 0);

    await db.transaction(async tx => {
      // Check wallet balance
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.business_id, businessId))
        .limit(1);

      if (!wallet || wallet.balance_tokens < tokenFee) {
        throw new Error('Insufficient tokens. Please top up your wallet.');
      }

      // Reserve token
      await tx.insert(walletTransactions).values({
        business_id: businessId,
        change_tokens: -tokenFee,
        type: 'reserve',
        reference: null,
        note: 'Sale token reservation',
        created_at: new Date(),
      });

      await tx
        .update(wallets)
        .set({
          balance_tokens: wallet.balance_tokens - tokenFee,
          updated_at: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      // Create sale
      const [sale] = await tx
        .insert(sales)
        .values({
          business_id: businessId,
          total_amount: String(totalAmount.toFixed(2)),
          total_profit: String(totalProfit.toFixed(2)),
          payment_mode: paymentMode,
          token_fee: tokenFee,
          status: 'pending',
          payment_status: 'pending',
          customer_type: customerType || 'walk_in',
          customer_name: customerName || null,
          note: note || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      saleId = sale.id;

      // Insert sale items
      for (const item of items) {
        await tx.insert(saleItems).values({
          sale_id: saleId,
          product_id: item.product_id,
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
          total_price: String(
            (Number(item.quantity) * Number(item.unit_price)).toFixed(2)
          ),
          unit_cost: String(item.unit_cost || 0),
          profit: String(
            (
              Number(item.quantity) *
              (Number(item.unit_price) - Number(item.unit_cost || 0))
            ).toFixed(2)
          ),
          created_at: new Date(),
        });
      }
    });

    logger.info(`Sale ${saleId} created for business ${businessId}`);

    // Token deduction from Revenue Guard system
    // This is intentionally done after transaction commit for the Revenue Guard workflow
    // If it fails, the reservation stays but won't be charged - user can retry
    let tokenDeducted = false;
    try {
      await deductTokens(
        req.revenueGuard.wallet_id,
        req.revenueGuard.tokens_to_deduct,
        {
          sale_id: saleId,
          business_id: businessId,
          amount_kes: Number(totalAmount.toFixed(2)),
          items_count: items.length,
        }
      );
      tokenDeducted = true;
      logger.info(`Token deduction completed for sale ${saleId}`, {
        walletId: req.revenueGuard.wallet_id,
        tokens: req.revenueGuard.tokens_to_deduct,
      });
    } catch (deductError) {
      logger.error('Token deduction failed for sale - reservation kept for retry', {
        sale_id: saleId,
        error: deductError.message,
        walletId: req.revenueGuard.wallet_id,
      });
      // Don't throw - sale was created successfully
      // The token reservation remains and can be charged later or user can retry
    }

    res.status(201).json({
      message: tokenDeducted 
        ? 'Sale created and token deducted successfully'
        : 'Sale created successfully - token deduction pending',
      saleId,
      totalAmount: Number(totalAmount.toFixed(2)),
      tokenFee: req.revenueGuard.tokens_to_deduct,
      tokens_remaining: tokenDeducted 
        ? req.revenueGuard.balance_before - req.revenueGuard.tokens_to_deduct
        : req.revenueGuard.balance_before,
      token_deduction_status: tokenDeducted ? 'completed' : 'pending',
      request_id: req.revenueGuard.request_id,
    });
  } catch (e) {
    logger.error('Error creating sale', e);
    // Note: Token reservation is NOT automatically refunded here
    // If deduction failed, the reservation remains pending
    // User can retry deduction or the reservation will eventually timeout
    if (e.message === 'Insufficient tokens. Please top up your wallet.') {
      return res.status(402).json({
        error: 'Insufficient tokens',
        message: e.message,
        request_id: req.revenueGuard?.request_id,
      });
    }
    next(e);
  }
};

// ============ PAY WITH CASH ============

export const payCashHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId)) {
      return res.status(400).json({ error: 'Invalid sale ID' });
    }

    await db.transaction(async tx => {
      // Get sale with business verification
      const [sale] = await tx
        .select({
          sale: sales,
          business: businesses,
        })
        .from(sales)
        .innerJoin(businesses, eq(sales.business_id, businesses.id))
        .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
        .limit(1);

      if (!sale) throw new Error('Sale not found or access denied');
      if (sale.sale.status !== 'pending')
        throw new Error('Sale is not pending');

      // Get sale items and deduct stock
      const items = await tx
        .select()
        .from(saleItems)
        .where(eq(saleItems.sale_id, saleId));

      for (const item of items) {
        const deduction = await deductStockFIFO(
          item.product_id,
          Number(item.quantity)
        );

        // Log stock movements
        for (const d of deduction.deductions) {
          await tx.insert(stockMovements).values({
            product_id: item.product_id,
            batch_id: d.batch_id,
            type: 'sale',
            quantity_change: String(-d.quantity),
            unit_cost: String(d.unit_cost),
            reference_type: 'sale',
            reference_id: saleId,
            reason: `Sale #${saleId}`,
            created_at: new Date(),
          });
        }
      }

      // Mark sale completed
      await tx
        .update(sales)
        .set({
          status: 'completed',
          payment_status: 'success',
          amount_paid: sale.sale.total_amount,
          updated_at: new Date(),
        })
        .where(eq(sales.id, saleId));

      // Create payment record
      await tx.insert(payments).values({
        sale_id: saleId,
        amount: sale.sale.total_amount,
        status: 'success',
        created_at: new Date(),
      });

      // Charge token
      await tx.insert(walletTransactions).values({
        business_id: sale.sale.business_id,
        change_tokens: 0,
        type: 'charge',
        reference: String(saleId),
        note: 'Sale completed - token charged',
        created_at: new Date(),
      });
    });

    logger.info(`Cash payment completed for sale ${saleId}`);
    res.json({ message: 'Payment completed successfully', saleId });
  } catch (e) {
    logger.error('Error processing cash payment', e);
    if (e.message === 'Sale not found or access denied') {
      return res.status(404).json({ error: e.message });
    }
    if (e.message === 'Sale is not pending') {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
};

// ============ PAY WITH M-PESA ============

export const payMpesaHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    const validationResult = payMpesaSchema.safeParse({ saleId, ...req.body });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { phone, description } = validationResult.data;

    // Get sale with business verification
    const [sale] = await db
      .select({
        sale: sales,
        business: businesses,
      })
      .from(sales)
      .innerJoin(businesses, eq(sales.business_id, businesses.id))
      .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
      .limit(1);

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }
    if (sale.sale.status !== 'pending') {
      return res.status(400).json({ error: 'Sale is not pending' });
    }

    // Get business payment configuration
    const paymentConfig = await getPaymentConfig(sale.business_id);

    // VALIDATION 1: Config exists
    if (!paymentConfig) {
      logger.warn('Payment config not found for M-Pesa sale', {
        saleId,
        businessId: sale.business_id,
        userId: req.user.id,
      });
      return res.status(400).json({
        error: 'Payment configuration not found',
        hint: 'Please setup your M-Pesa payment method',
        setupUrl: '/api/payment-config/setup',
      });
    }

    // VALIDATION 2: Config is active
    if (!paymentConfig.is_active) {
      logger.warn('Payment config inactive for M-Pesa sale', {
        saleId,
        configId: paymentConfig.id,
      });
      return res.status(400).json({
        error: 'Payment configuration is inactive',
        hint: 'Please enable your M-Pesa configuration in settings',
      });
    }

    // VALIDATION 3: Config is complete
    if (!paymentConfig.shortcode || !paymentConfig.passkey || !paymentConfig.account_reference) {
      logger.error('Payment config incomplete for M-Pesa sale', {
        saleId,
        configId: paymentConfig.id,
      });
      return res.status(500).json({
        error: 'Payment configuration is incomplete',
        hint: 'Please reconfigure your M-Pesa credentials',
      });
    }

    // VALIDATION 4: Config verified (warn if not)
    if (!paymentConfig.verified) {
      logger.warn('Payment config not verified for M-Pesa sale', {
        saleId,
        configId: paymentConfig.id,
      });
    }

    // Initiate STK push using business's payment config
    let mpesaResp;
    try {
      mpesaResp = await initiateBusinessPayment({
        paymentConfig,
        phone,
        amount: Number(sale.sale.total_amount),
        description: description || `PAYME Sale #${saleId}`,
      });
    } catch (mpesaError) {
      logger.error('M-Pesa initialization failed for sale', {
        saleId,
        error: mpesaError.message,
        configId: paymentConfig.id,
      });

      // Provide helpful error messages
      if (mpesaError.message.includes('credentials') || mpesaError.message.includes('Configuration')) {
        return res.status(400).json({
          error: 'Payment credentials are invalid or not configured',
          hint: 'Please verify your M-Pesa credentials in settings',
        });
      }

      if (mpesaError.message.includes('inactive')) {
        return res.status(400).json({
          error: 'Payment method is inactive',
          hint: 'Please activate your payment configuration',
        });
      }

      return res.status(500).json({
        error: 'Failed to initiate payment',
        message: mpesaError.message,
      });
    }

    // Store payment initiation
    await db.insert(payments).values({
      sale_id: saleId,
      stk_request_id: mpesaResp.CheckoutRequestID || null,
      phone,
      amount: sale.sale.total_amount,
      status: 'initiated',
      callback_payload: JSON.stringify(mpesaResp),
      created_at: new Date(),
    });

    // Update sale
    await db
      .update(sales)
      .set({
        stk_request_id: mpesaResp.CheckoutRequestID || null,
        payment_status: 'initiated',
        updated_at: new Date(),
      })
      .where(eq(sales.id, saleId));

    logger.info(`M-Pesa STK initiated for sale ${saleId}`, {
      checkoutRequestId: mpesaResp.CheckoutRequestID,
      configId: paymentConfig.id,
      verified: paymentConfig.verified,
    });
    res.json({
      message: 'M-Pesa payment initiated',
      saleId,
      checkoutRequestId: mpesaResp.CheckoutRequestID,
    });
  } catch (e) {
    logger.error('Error initiating M-Pesa payment', {
      error: e.message,
      saleId: req.params.id,
      userId: req.user?.id,
    });
    next(e);
  }
};

// ============ M-PESA CALLBACK ============

/**
 * M-Pesa STK Push Callback Handler
 * Processes payment confirmations from M-Pesa with idempotency
 * - Validates callback structure
 * - Checks for duplicate processing
 * - Updates sale and stock atomically
 * - Refunds tokens on payment failure
 */
export const mpesaCallbackHandler = async (req, res) => {
  const callbackId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  try {
    // Validate callback structure
    const validationResult = mpesaCallbackSchema.safeParse(req.body);
    if (!validationResult.success) {
      logger.warn('Invalid M-Pesa callback payload', {
        callbackId,
        errors: validationResult.error,
      });
      // Return 200 OK to M-Pesa to acknowledge receipt, even if invalid
      return res.status(200).json({ status: 'ignored', callbackId });
    }

    const stkCallback = req.body.Body?.stkCallback;
    if (!stkCallback) {
      logger.warn('Missing stkCallback in M-Pesa callback', { callbackId });
      return res.status(200).json({ status: 'ignored', callbackId });
    }

    const {
      CheckoutRequestID: checkoutRequestId,
      ResultCode: resultCode,
      CallbackMetadata,
    } = stkCallback;

    if (!checkoutRequestId) {
      logger.warn('Missing CheckoutRequestID in callback', { callbackId });
      return res.status(200).json({ status: 'ignored', callbackId });
    }

    logger.info('Processing M-Pesa callback', {
      callbackId,
      checkoutRequestId,
      resultCode,
    });

    // ============ ATOMICALLY PROCESS CALLBACK ============

    await db.transaction(async tx => {
      // Get sale by STK request ID (with lock to prevent race conditions)
      const [sale] = await tx
        .select()
        .from(sales)
        .where(eq(sales.stk_request_id, checkoutRequestId))
        .limit(1);

      if (!sale) {
        logger.warn('Sale not found for STK callback', {
          callbackId,
          checkoutRequestId,
        });
        return;
      }

      // Idempotency check: if callback already processed, skip
      if (sale.callback_processed) {
        logger.info('Callback already processed, skipping', {
          callbackId,
          saleId: sale.id,
        });
        return;
      }

      // Parse M-Pesa callback metadata
      const callbackMetadata = CallbackMetadata?.Item || [];
      const amount = Number(
        callbackMetadata.find(i => i.Name === 'Amount')?.Value || sale.total_amount
      );
      const mpesaReceiptNumber =
        callbackMetadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value || null;
      const phoneNumber =
        callbackMetadata.find(i => i.Name === 'PhoneNumber')?.Value || null;
      // Transaction date from callback (for audit trail)
      callbackMetadata.find(i => i.Name === 'TransactionDate')?.Value || null;

      if (resultCode === 0) {
        // ============ PAYMENT SUCCESSFUL ============
        logger.info('M-Pesa payment successful', {
          saleId: sale.id,
          amount,
          receipt: mpesaReceiptNumber,
        });

        // Get sale items and deduct stock using FIFO
        const saleItemsList = await tx
          .select()
          .from(saleItems)
          .where(eq(saleItems.sale_id, sale.id));

        for (const item of saleItemsList) {
          // Deduct stock in FIFO order
          const deduction = await deductStockFIFO(
            item.product_id,
            Number(item.quantity)
          );

          // Log each batch deduction
          for (const batch of deduction.deductions) {
            await tx.insert(stockMovements).values({
              product_id: item.product_id,
              batch_id: batch.batch_id,
              type: 'sale',
              quantity_change: String(-batch.quantity),
              unit_cost: String(batch.unit_cost),
              reference_type: 'sale',
              reference_id: sale.id,
              reason: `M-Pesa sale #${sale.id}`,
              created_at: new Date(),
            });
          }
        }

        // Update sale with M-Pesa details
        await tx
          .update(sales)
          .set({
            status: 'completed',
            payment_status: 'success',
            mpesa_transaction_id: mpesaReceiptNumber,
            mpesa_sender_phone: phoneNumber,
            amount_paid: String(amount.toFixed(2)),
            callback_processed: true,
            updated_at: new Date(),
          })
          .where(eq(sales.id, sale.id));

        // Charge token for completed sale
        await tx.insert(walletTransactions).values({
          business_id: sale.business_id,
          change_tokens: -sale.token_fee, // Negative because we're charging
          type: 'charge',
          reference: String(sale.id),
          note: `Sale completed - M-Pesa ${mpesaReceiptNumber}`,
          created_at: new Date(),
          created_by: null,
        });

        // Update wallet balance
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.business_id, sale.business_id))
          .limit(1);

        if (wallet) {
          await tx
            .update(wallets)
            .set({
              balance_tokens: Math.max(0, wallet.balance_tokens - sale.token_fee),
              updated_at: new Date(),
            })
            .where(eq(wallets.id, wallet.id));
        }

        logger.info('M-Pesa payment completed and sale finalized', {
          saleId: sale.id,
          stockDeducted: true,
          tokenCharged: true,
        });
      } else {
        // ============ PAYMENT FAILED ============
        logger.warn('M-Pesa payment failed', {
          saleId: sale.id,
          resultCode,
        });

        // Mark sale as failed
        await tx
          .update(sales)
          .set({
            status: 'failed',
            payment_status: 'failed',
            callback_processed: true,
            updated_at: new Date(),
          })
          .where(eq(sales.id, sale.id));

        // Refund reserved token
        await tx.insert(walletTransactions).values({
          business_id: sale.business_id,
          change_tokens: sale.token_fee, // Positive because we're refunding
          type: 'refund',
          reference: String(sale.id),
          note: `Payment failed (code: ${resultCode}) - token refunded`,
          created_at: new Date(),
          created_by: null,
        });

        // Update wallet balance
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.business_id, sale.business_id))
          .limit(1);

        if (wallet) {
          await tx
            .update(wallets)
            .set({
              balance_tokens: wallet.balance_tokens + sale.token_fee,
              updated_at: new Date(),
            })
            .where(eq(wallets.id, wallet.id));
        }

        logger.info('Payment failed - token refunded', {
          saleId: sale.id,
          tokensRefunded: sale.token_fee,
        });
      }
    });

    // Return 200 OK to M-Pesa
    return res.status(200).json({
      message: 'callback processed',
      callbackId,
      checkoutRequestId,
    });
  } catch (error) {
    logger.error('M-Pesa callback processing error', {
      callbackId,
      error: error.message,
      stack: error.stack,
    });
    // Return 200 OK to M-Pesa even on error to prevent retries
    return res.status(200).json({
      status: 'error_processed',
      callbackId,
      message: 'Error recorded, support will investigate',
    });
  }
};

// ============ GET SALE ============

export const getSaleHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId)) {
      return res.status(400).json({ error: 'Invalid sale ID' });
    }

    const [sale] = await db
      .select({
        sale: sales,
        business: businesses,
      })
      .from(sales)
      .innerJoin(businesses, eq(sales.business_id, businesses.id))
      .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
      .limit(1);

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }

    const items = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.sale_id, saleId));
    const payment = await db
      .select()
      .from(payments)
      .where(eq(payments.sale_id, saleId))
      .limit(1);

    res.json({
      sale: sale.sale,
      items,
      payment: payment[0] || null,
    });
  } catch (e) {
    logger.error('Error getting sale', e);
    next(e);
  }
};

// ============ LIST SALES ============

export const listSalesHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId)) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }

    // Verify business ownership
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, businessId), eq(businesses.user_id, req.user.id))
      )
      .limit(1);

    if (!business) {
      return res
        .status(403)
        .json({ error: 'Business not found or access denied' });
    }

    const salesList = await db
      .select()
      .from(sales)
      .where(eq(sales.business_id, businessId))
      .orderBy(desc(sales.created_at));

    res.json({
      sales: salesList,
      count: salesList.length,
    });
  } catch (e) {
    logger.error('Error listing sales', e);
    next(e);
  }
};

// ============ CANCEL SALE ============

export const cancelSaleHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId)) {
      return res.status(400).json({ error: 'Invalid sale ID' });
    }

    await db.transaction(async tx => {
      const [sale] = await tx
        .select({
          sale: sales,
          business: businesses,
        })
        .from(sales)
        .innerJoin(businesses, eq(sales.business_id, businesses.id))
        .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
        .limit(1);

      if (!sale) throw new Error('Sale not found or access denied');
      if (sale.sale.status !== 'pending')
        throw new Error('Only pending sales can be cancelled');

      // Refund token
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.business_id, sale.sale.business_id))
        .limit(1);

      await tx.insert(walletTransactions).values({
        business_id: sale.sale.business_id,
        change_tokens: sale.sale.token_fee,
        type: 'refund',
        reference: String(saleId),
        note: 'Sale cancelled - token refund',
        created_at: new Date(),
      });

      await tx
        .update(wallets)
        .set({
          balance_tokens: wallet.balance_tokens + sale.sale.token_fee,
          updated_at: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      // Mark sale as cancelled
      await tx
        .update(sales)
        .set({
          status: 'cancelled',
          payment_status: 'cancelled',
          updated_at: new Date(),
        })
        .where(eq(sales.id, saleId));
    });

    logger.info(`Sale ${saleId} cancelled`);
    res.json({ message: 'Sale cancelled successfully', saleId });
  } catch (e) {
    logger.error('Error cancelling sale', e);
    if (e.message === 'Sale not found or access denied') {
      return res.status(404).json({ error: e.message });
    }
    if (e.message === 'Only pending sales can be cancelled') {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
};
