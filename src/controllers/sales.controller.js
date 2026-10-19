import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, desc } from 'drizzle-orm';
import { mpesaCallbackSchema } from '#validations/sales.validation.js';
import { sales, saleItems } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { wallets, walletTransactions } from '#models/myWallet.model.js';
import { businesses } from '#models/setting.model.js';
import { checkAndNotifyLowStock } from '#services/stock.service.js';
import { createRecord } from '#services/record.service.js';
import { applyCallback } from '#services/mpesaAttempt.service.js';
// emitNotification / notifications were already being called by
// mpesaCallbackHandler without ever being imported — a ReferenceError that
// would have fired on the first successful M-Pesa callback. It had not
// surfaced because, as the audit found, no STK push has ever completed.
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

/**
 * NOTE: createSaleHandler has been retired.
 * POST /api/payme/ is now the sole entry point for all sale creation.
 * This controller handles: the M-Pesa callback, sale queries, and
 * cancellation only.
 */


// ─────────────────────────────────────────────
// M-PESA CALLBACK HANDLER
// POST /api/sales/mpesa/callback
// Called by Safaricom after STK push — public endpoint.
// Returns 200 always to prevent Safaricom retries.
//
// This is where an M-Pesa sale is BORN, not where it is updated. The push
// itself only staged an attempt (mpesa_attempts) and held the stock; if the
// customer cancels, the PIN times out, or the balance is short, this handler
// releases the hold and writes nothing at all to `sales`. That is the whole
// point of the restructure — a failed payment is not a sale, and must not
// leave a row that looks like one.
//
// All the transactional work lives in mpesaAttempt.service.applyCallback(),
// which locks the attempt row (SELECT … FOR UPDATE) so Safaricom's retries
// are idempotent.
//
// createRecord() (token deduction + ledger entry) and the push notification
// run AFTER that transaction commits, not inside it. Calling createRecord()
// from inside meant it silently opened a SECOND, independent transaction
// while the first one hadn't committed yet. The "non-fatal, don't undo the
// sale" tolerance for a token failure here is intentional and correct
// specifically for M-Pesa: by the time resultCode === 0 fires, the customer
// has genuinely already paid, so refusing to record the sale would mean the
// shop keeps the money while the app pretends it never happened — worse than
// a billing gap.
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
      ResultDesc: resultDesc,
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

    const metaItems = CallbackMetadata?.Item || [];
    const amount = metaItems.find(i => i.Name === 'Amount')?.Value ?? null;
    const mpesaReceiptNumber =
      metaItems.find(i => i.Name === 'MpesaReceiptNumber')?.Value || null;
    const phoneNumber =
      metaItems.find(i => i.Name === 'PhoneNumber')?.Value?.toString() || null;

    const result = await applyCallback({
      checkoutRequestId,
      resultCode,
      resultDesc,
      amount,
      mpesaReceiptNumber,
      phoneNumber,
      rawPayload: req.body,
    });

    if (result.outcome === 'no_attempt') {
      // Logged at error level on purpose: if this fires with resultCode 0,
      // a customer has paid for something we have no cart for, and it needs
      // manual reconciliation. The most likely cause is the process dying
      // between the STK push and attachCheckoutRequestId().
      logger.error('M-Pesa callback for unknown attempt', {
        callbackId,
        checkoutRequestId,
        resultCode,
        payload: resultCode === 0 ? JSON.stringify(req.body) : undefined,
      });
      return res.status(200).json({ status: 'unknown_attempt', callbackId });
    }

    if (result.outcome === 'duplicate') {
      logger.info('Callback already processed — skipping', {
        callbackId,
        attemptId: result.attemptId,
        status: result.status,
      });
      return res.status(200).json({ status: 'already_processed', callbackId });
    }

    // ── Post-commit side effects (success only) ──────────────────
    // Deliberately outside the transaction, and deliberately non-fatal:
    // the money is already in the shop's account.
    if (result.outcome === 'success') {
      try {
        await createRecord({
          business_id: result.businessId,
          user_id: result.userId ?? null,
          type: 'sales',
          category: 'mpesa',
          amount: result.amount,
          payment_method: 'mpesa',
          transaction_date: new Date(),
          reference_id: String(result.saleId),
          description: `M-Pesa sale #${result.saleId}`,
          mpesa_data: {
            mpesaReceiptNumber: result.mpesaReceiptNumber,
            phoneNumber: result.phoneNumber,
          },
          items: result.items.map(item => ({
            item_name: item.product_name || `Product #${item.product_id}`,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            product_id: item.product_id,
            cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
          })),
        });
      } catch (recordError) {
        logger.error('M-Pesa sale recorded but token/ledger entry failed', {
          callbackId,
          saleId: result.saleId,
          error: recordError.message,
        });
      }

      // Low-stock check per product — only meaningful now that stock has
      // actually been deducted (the hold alone never moved it).
      for (const item of result.items) {
        try {
          await checkAndNotifyLowStock(result.businessId, item.product_id);
        } catch (lowStockError) {
          logger.error('Low-stock check failed after M-Pesa sale', {
            productId: item.product_id,
            error: lowStockError.message,
          });
        }
      }

      try {
        const [business] = await db
          .select({ user_id: businesses.user_id })
          .from(businesses)
          .where(eq(businesses.id, result.businessId))
          .limit(1);

        if (business) {
          await emitNotification({
            user_id: business.user_id,
            business_id: result.businessId,
            ...notifications.paymentComplete({
              amount: result.amount,
              sale_id: result.saleId,
              phone: result.phoneNumber,
            }),
          });
        }
      } catch (notifyError) {
        logger.error('Failed to emit payment notification', {
          callbackId,
          saleId: result.saleId,
          error: notifyError.message,
        });
      }
    }

    // Always return 200 to Safaricom to prevent retries
    return res.status(200).json({
      message: 'Callback processed',
      callbackId,
      checkoutRequestId,
      outcome: result.outcome,
      ...(result.saleId ? { sale_id: result.saleId } : {}),
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