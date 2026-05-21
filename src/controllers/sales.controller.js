import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, desc } from 'drizzle-orm';
import { formatValidationError } from '#utils/format.js';
import { initiateBusinessPayment } from '#utils/mpesa.js';
import { getPaymentConfig } from '#services/paymentConfig.service.js';
import {
  payMpesaSchema,
  mpesaCallbackSchema,
} from '#validations/sales.validation.js';
import { sales, saleItems } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { wallets, walletTransactions } from '#models/myWallet.model.js';
import { businesses } from '#models/setting.model.js';
import { stockMovements } from '#models/stock.model.js';
import { deductStockFIFO } from '#services/stock.service.js';
import { createRecord } from '#services/record.service.js';

/**
 * NOTE: createSaleHandler has been retired.
 * POST /api/payme/ is now the sole entry point for all sale creation.
 * This controller handles: cash confirmation, M-Pesa STK, M-Pesa callback,
 * sale queries, and cancellation only.
 */

// ─────────────────────────────────────────────
// PAY WITH CASH
// POST /api/sales/:id/pay/cash
// Only called if a sale was left in pending state and needs manual cash confirmation.
// For normal PayMe cash sales this is handled directly in processPayMe.
// ─────────────────────────────────────────────

export const payCashHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId)) {
      return res.status(400).json({ error: 'Invalid sale ID' });
    }

    let completedSale;
    let completedItems;

    await db.transaction(async tx => {
      // Verify sale belongs to this user's business
      const [row] = await tx
        .select({ sale: sales, business: businesses })
        .from(sales)
        .innerJoin(businesses, eq(sales.business_id, businesses.id))
        .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
        .limit(1);

      if (!row) throw new Error('Sale not found or access denied');
      if (row.sale.status !== 'pending') throw new Error('Sale is not pending');

      const items = await tx
        .select()
        .from(saleItems)
        .where(eq(saleItems.sale_id, saleId));

      // Deduct stock using FIFO and backfill unit_cost + profit on saleItems
      for (const item of items) {
        const deduction = await deductStockFIFO(
          item.product_id,
          Number(item.quantity),
          tx
        );

        const totalCost = deduction.deductions.reduce(
          (sum, d) => sum + d.total_cost,
          0
        );
        const unitCost =
          Number(item.quantity) > 0 ? totalCost / Number(item.quantity) : 0;
        const realProfit = Number(item.total_price) - totalCost;

        // Update saleItem with real FIFO cost
        await tx
          .update(saleItems)
          .set({
            unit_cost: String(Number(unitCost.toFixed(4))),
            profit: String(Number(realProfit.toFixed(2))),
          })
          .where(
            and(
              eq(saleItems.sale_id, saleId),
              eq(saleItems.product_id, item.product_id)
            )
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
            reason: `Cash sale #${saleId} - FIFO batch ${d.batch_id}`,
            created_at: new Date(),
          });
        }
      }

      // Recalculate total profit from updated items
      const updatedItems = await tx
        .select()
        .from(saleItems)
        .where(eq(saleItems.sale_id, saleId));

      const realTotalProfit = updatedItems.reduce(
        (sum, i) => sum + Number(i.profit || 0),
        0
      );

      // Mark sale completed
      await tx
        .update(sales)
        .set({
          status: 'completed',
          payment_status: 'success',
          amount_paid: row.sale.total_amount,
          total_profit: String(Number(realTotalProfit.toFixed(2))),
          updated_at: new Date(),
        })
        .where(eq(sales.id, saleId));

      // Create payment record
      await tx.insert(payments).values({
        sale_id: saleId,
        amount: row.sale.total_amount,
        status: 'success',
        created_at: new Date(),
      });

      // Fetch completed sale + items for ledger write (outside tx to get updated values)
      completedSale = {
        ...row.sale,
        status: 'completed',
        payment_mode: 'cash',
      };
      completedItems = updatedItems;
    });

    logger.info(`Cash payment completed for sale ${saleId}`);

    // Write to financial ledger — token deducted here via createRecord()
    try {
      await createRecord({
        business_id: completedSale.business_id,
        user_id: req.user.id,
        type: 'sales',
        category: 'cash',
        amount: Number(completedSale.total_amount),
        payment_method: 'cash',
        transaction_date: new Date(),
        reference_id: String(saleId),
        description: `Cash sale #${saleId}`,
        items: completedItems.map(item => ({
          item_name: item.product_name || `Product #${item.product_id}`,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          product_id: item.product_id,
          cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
        })),
      });
    } catch (recordError) {
      // Non-fatal: sale succeeded, log for backfill
      logger.error('Failed to write cash sale to ledger', {
        sale_id: saleId,
        error: recordError.message,
      });
    }

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

// ─────────────────────────────────────────────
// INITIATE M-PESA STK PUSH
// POST /api/sales/:id/pay/mpesa
// Called after a pending M-Pesa sale is created via PayMe
// ─────────────────────────────────────────────

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

    // Verify sale belongs to this user
    const [row] = await db
      .select({ sale: sales, business: businesses })
      .from(sales)
      .innerJoin(businesses, eq(sales.business_id, businesses.id))
      .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }
    if (row.sale.status !== 'pending') {
      return res.status(400).json({ error: 'Sale is not pending' });
    }

    // Get business M-Pesa config
    const paymentConfig = await getPaymentConfig(row.sale.business_id);

    if (!paymentConfig) {
      return res.status(400).json({
        error: 'Payment configuration not found',
        message: 'Please set up your M-Pesa till or paybill in Settings.',
        setup_url: '/api/payment-config/fields?method=paybill',
      });
    }

    if (!paymentConfig.is_active) {
      return res.status(400).json({
        error: 'Payment configuration is inactive',
        message: 'Please activate your M-Pesa configuration in Settings.',
      });
    }

    if (!paymentConfig.shortcode || !paymentConfig.passkey) {
      return res.status(400).json({
        error: 'Payment configuration is incomplete',
        message: 'Please reconfigure your M-Pesa credentials in Settings.',
      });
    }

    // Initiate STK push to customer's phone
    let mpesaResp;
    try {
      mpesaResp = await initiateBusinessPayment({
        paymentConfig,
        phone,
        amount: Number(row.sale.total_amount),
        description: description || `PAYME Sale #${saleId}`,
      });
    } catch (mpesaError) {
      logger.error('M-Pesa STK push failed', {
        saleId,
        error: mpesaError.message,
      });
      return res.status(500).json({
        error: 'Failed to initiate M-Pesa payment',
        message: mpesaError.message,
      });
    }

    // Store payment initiation record
    await db.insert(payments).values({
      sale_id: saleId,
      stk_request_id: mpesaResp.CheckoutRequestID || null,
      phone,
      amount: row.sale.total_amount,
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
      .where(eq(sales.id, saleId));

    logger.info(`M-Pesa STK initiated for sale ${saleId}`, {
      checkoutRequestId: mpesaResp.CheckoutRequestID,
    });

    res.json({
      message: 'M-Pesa payment initiated. Customer will receive a prompt.',
      saleId,
      checkoutRequestId: mpesaResp.CheckoutRequestID,
    });
  } catch (e) {
    logger.error('Error initiating M-Pesa payment', {
      error: e.message,
      saleId: req.params.id,
    });
    next(e);
  }
};

// ─────────────────────────────────────────────
// M-PESA CALLBACK HANDLER
// POST /api/sales/mpesa/callback
// Called by Safaricom after STK push — public endpoint
// Returns 200 always to prevent Safaricom retries
// ─────────────────────────────────────────────

export const mpesaCallbackHandler = async (req, res) => {
  const callbackId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  try {
    // Validate callback structure
    const validationResult = mpesaCallbackSchema.safeParse(req.body);
    if (!validationResult.success) {
      logger.warn('Invalid M-Pesa callback payload', { callbackId });
      return res.status(200).json({ status: 'ignored', callbackId });
    }

    const stkCallback = req.body.Body?.stkCallback;
    if (!stkCallback) {
      logger.warn('Missing stkCallback body', { callbackId });
      return res.status(200).json({ status: 'ignored', callbackId });
    }

    const {
      CheckoutRequestID: checkoutRequestId,
      ResultCode: resultCode,
      CallbackMetadata,
    } = stkCallback;

    if (!checkoutRequestId) {
      return res.status(200).json({ status: 'ignored', callbackId });
    }

    logger.info('Processing M-Pesa callback', {
      callbackId,
      checkoutRequestId,
      resultCode,
    });

    await db.transaction(async tx => {
      // Find sale by STK request ID
      const [sale] = await tx
        .select()
        .from(sales)
        .where(eq(sales.stk_request_id, checkoutRequestId))
        .limit(1);

      if (!sale) {
        logger.warn('No sale found for STK callback', {
          callbackId,
          checkoutRequestId,
        });
        return;
      }

      // Idempotency: skip if already processed
      if (
        sale.payment_status === 'success' ||
        sale.payment_status === 'failed'
      ) {
        logger.info('Callback already processed — skipping', {
          saleId: sale.id,
          callbackId,
        });
        return;
      }

      // Parse callback metadata
      const metaItems = CallbackMetadata?.Item || [];
      const amount = Number(
        metaItems.find(i => i.Name === 'Amount')?.Value || sale.total_amount
      );
      const mpesaReceiptNumber =
        metaItems.find(i => i.Name === 'MpesaReceiptNumber')?.Value || null;
      const phoneNumber =
        metaItems.find(i => i.Name === 'PhoneNumber')?.Value?.toString() ||
        null;

      if (resultCode === 0) {
        // ══════════════════════════════════════
        // PAYMENT SUCCESSFUL
        // ══════════════════════════════════════

        // Fetch sale items for stock deduction + ledger
        const saleItemsList = await tx
          .select()
          .from(saleItems)
          .where(eq(saleItems.sale_id, sale.id));

        // Deduct stock FIFO and backfill real unit_cost + profit on saleItems
        for (const item of saleItemsList) {
          const deduction = await deductStockFIFO(
            item.product_id,
            Number(item.quantity),
            tx
          );

          const totalCost = deduction.deductions.reduce(
            (sum, d) => sum + d.total_cost,
            0
          );
          const unitCost =
            Number(item.quantity) > 0 ? totalCost / Number(item.quantity) : 0;
          const realProfit = Number(item.total_price) - totalCost;

          // Backfill correct FIFO cost on saleItem row
          await tx
            .update(saleItems)
            .set({
              unit_cost: String(Number(unitCost.toFixed(4))),
              profit: String(Number(realProfit.toFixed(2))),
            })
            .where(
              and(
                eq(saleItems.sale_id, sale.id),
                eq(saleItems.product_id, item.product_id)
              )
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
              reference_id: sale.id,
              reason: `M-Pesa sale #${sale.id} - batch ${d.batch_id}`,
              created_at: new Date(),
            });
          }
        }

        // Fetch updated items to recalculate total profit
        const updatedItems = await tx
          .select()
          .from(saleItems)
          .where(eq(saleItems.sale_id, sale.id));

        const realTotalProfit = updatedItems.reduce(
          (sum, i) => sum + Number(i.profit || 0),
          0
        );

        // Mark sale completed
        await tx
          .update(sales)
          .set({
            status: 'completed',
            payment_status: 'success',
            mpesa_transaction_id: mpesaReceiptNumber,
            mpesa_sender_phone: phoneNumber,
            amount_paid: String(amount.toFixed(2)),
            total_profit: String(Number(realTotalProfit.toFixed(2))),
            updated_at: new Date(),
          })
          .where(eq(sales.id, sale.id));

        // Update payment record
        await tx
          .update(payments)
          .set({
            status: 'success',
            mpesa_transaction_id: mpesaReceiptNumber,
            callback_payload: JSON.stringify(req.body),
            updated_at: new Date(),
          })
          .where(eq(payments.stk_request_id, checkoutRequestId));

        // Log charge event — balance was NOT pre-reserved
        // createRecord() below handles the actual token deduction
        await tx.insert(walletTransactions).values({
          business_id: sale.business_id,
          change_tokens: 0,
          type: 'charge',
          reference: String(sale.id),
          note: `M-Pesa sale #${sale.id} completed — ${mpesaReceiptNumber}`,
          created_at: new Date(),
          created_by: null,
        });

        logger.info('M-Pesa sale finalized', {
          saleId: sale.id,
          receipt: mpesaReceiptNumber,
          amount,
          totalProfit: realTotalProfit,
        });

        // Write to financial ledger — token deducted here via createRecord()
        try {
          await createRecord({
            business_id: sale.business_id,
            user_id: null, // system-generated via callback
            type: 'sales',
            category: 'mpesa',
            amount,
            payment_method: 'mpesa',
            transaction_date: new Date(),
            reference_id: String(sale.id),
            description: `M-Pesa sale #${sale.id}`,
            mpesa_data: {
              mpesaReceiptNumber,
              phoneNumber,
            },
            items: updatedItems.map(item => ({
              item_name: item.product_name || `Product #${item.product_id}`,
              quantity: Number(item.quantity),
              unit_price: Number(item.unit_price),
              product_id: item.product_id,
              cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
            })),
          });
        } catch (recordError) {
          // Non-fatal — sale succeeded, record can be backfilled
          logger.error('Failed to write M-Pesa sale to ledger', {
            sale_id: sale.id,
            error: recordError.message,
          });
        }
      } else {
        // ══════════════════════════════════════
        // PAYMENT FAILED
        // ══════════════════════════════════════
        logger.warn('M-Pesa payment failed', {
          saleId: sale.id,
          resultCode,
          callbackId,
        });

        await tx
          .update(sales)
          .set({
            status: 'failed',
            payment_status: 'failed',
            updated_at: new Date(),
          })
          .where(eq(sales.id, sale.id));

        await tx
          .update(payments)
          .set({
            status: 'failed',
            callback_payload: JSON.stringify(req.body),
            updated_at: new Date(),
          })
          .where(eq(payments.stk_request_id, checkoutRequestId));

        // Refund reserved token if one was reserved
        if (sale.token_fee > 0) {
          const [wallet] = await tx
            .select()
            .from(wallets)
            .where(eq(wallets.business_id, sale.business_id))
            .limit(1);

          if (wallet) {
            await tx.insert(walletTransactions).values({
              business_id: sale.business_id,
              change_tokens: sale.token_fee,
              type: 'refund',
              reference: String(sale.id),
              note: `Payment failed (code: ${resultCode}) — token refunded`,
              created_at: new Date(),
              created_by: null,
            });

            await tx
              .update(wallets)
              .set({
                balance_tokens: wallet.balance_tokens + sale.token_fee,
                updated_at: new Date(),
              })
              .where(eq(wallets.id, wallet.id));
          }
        }

        logger.info('Payment failed — token refunded', {
          saleId: sale.id,
          resultCode,
        });
      }
    });

    // Always return 200 to Safaricom to prevent retries
    return res.status(200).json({
      message: 'Callback processed',
      callbackId,
      checkoutRequestId,
    });
  } catch (error) {
    logger.error('M-Pesa callback processing error', {
      callbackId,
      error: error.message,
      stack: error.stack,
    });
    // Always 200 — prevents Safaricom from retrying endlessly
    return res.status(200).json({
      status: 'error_logged',
      callbackId,
      message: 'Error recorded',
    });
  }
};

// ─────────────────────────────────────────────
// GET SINGLE SALE
// GET /api/sales/:id
// ─────────────────────────────────────────────

export const getSaleHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId)) {
      return res.status(400).json({ error: 'Invalid sale ID' });
    }

    const [row] = await db
      .select({ sale: sales, business: businesses })
      .from(sales)
      .innerJoin(businesses, eq(sales.business_id, businesses.id))
      .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }

    const items = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.sale_id, saleId));

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.sale_id, saleId))
      .limit(1);

    res.json({
      sale: row.sale,
      items,
      payment: payment || null,
    });
  } catch (e) {
    logger.error('Error getting sale', e);
    next(e);
  }
};

// ─────────────────────────────────────────────
// LIST SALES FOR BUSINESS
// GET /api/sales/business/:businessId
// ─────────────────────────────────────────────

export const listSalesHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId)) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }

    // Verify ownership
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

// ─────────────────────────────────────────────
// CANCEL PENDING SALE
// POST /api/sales/:id/cancel
// ─────────────────────────────────────────────

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
      const [row] = await tx
        .select({ sale: sales, business: businesses })
        .from(sales)
        .innerJoin(businesses, eq(sales.business_id, businesses.id))
        .where(and(eq(sales.id, saleId), eq(businesses.user_id, req.user.id)))
        .limit(1);

      if (!row) throw new Error('Sale not found or access denied');
      if (row.sale.status !== 'pending')
        throw new Error('Only pending sales can be cancelled');

      // Refund token if one was reserved
      if (row.sale.token_fee > 0) {
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.business_id, row.sale.business_id))
          .limit(1);

        if (wallet) {
          await tx.insert(walletTransactions).values({
            business_id: row.sale.business_id,
            change_tokens: row.sale.token_fee,
            type: 'refund',
            reference: String(saleId),
            note: 'Sale cancelled — token refunded',
            created_at: new Date(),
          });

          await tx
            .update(wallets)
            .set({
              balance_tokens: wallet.balance_tokens + row.sale.token_fee,
              updated_at: new Date(),
            })
            .where(eq(wallets.id, wallet.id));
        }
      }

      await tx
        .update(sales)
        .set({
          status: 'cancelled',
          payment_status: 'cancelled',
          updated_at: new Date(),
        })
        .where(eq(sales.id, saleId));
    });

    logger.info(`Sale ${saleId} cancelled by user ${req.user.id}`);
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
