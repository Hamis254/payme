/**
 * =============================================================================
 * SERVICE: M-PESA ATTEMPT STAGING
 * =============================================================================
 * An STK push is a request for money, not a sale. This service keeps the two
 * apart.
 *
 * Old flow (removed):
 *   push → INSERT sales(status 'pending') → callback → UPDATE that row
 * A cancelled push therefore left a permanent, real-looking sale row behind
 * (two were found in production, KES 8,750, with three orphaned sale_items),
 * and between push and callback the stock was neither deducted nor held — so
 * two people could be sold the same last unit.
 *
 * New flow:
 *   push     → reserve stock + INSERT mpesa_attempts   (zero rows in `sales`)
 *   success  → convert the hold into a real FIFO deduction, THEN create the
 *              sale + sale_items + payment record
 *   failure  → release the hold, mark the attempt failed (zero rows in `sales`)
 *   timeout  → same as failure, via sweepStaleAttempts()
 *
 * The reservation is what closes the race: reserveStockFIFO increments
 * reserved_quantity in a single conditional UPDATE, so the second concurrent
 * push for the last unit fails at the database rather than both succeeding.
 *
 * @module services/mpesaAttempt.service
 * =============================================================================
 */

import crypto from 'node:crypto';
import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, lt, inArray, sql } from 'drizzle-orm';
import { mpesaAttempts } from '#models/mpesaAttempt.model.js';
import { sales, saleItems } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { walletTransactions } from '#models/myWallet.model.js';
import { stockMovements } from '#models/stock.model.js';
import {
  reserveStockFIFO,
  releaseStockReservation,
  deductStockFIFO,
} from '#services/stock.service.js';
import { validateAndCalculateCart } from '#services/sales.service.js';

/** Attempts older than this with no callback are presumed abandoned. */
export const ATTEMPT_TIMEOUT_MINUTES = 10;

const REF_TYPE = 'mpesa_attempt';

/**
 * Placeholder key used between reserving stock and hearing back from
 * Safaricom. checkout_request_id is UNIQUE and NOT NULL, and we don't know
 * the real CheckoutRequestID until the push returns — but the stock has to
 * be held BEFORE the customer's phone lights up, otherwise the race we're
 * closing is still open for the duration of the Daraja round-trip.
 */
const localRef = () => `local:${crypto.randomUUID()}`;

const parseCart = attempt => {
  try {
    const parsed = JSON.parse(attempt.cart_items);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    logger.error('Corrupt cart_items on M-Pesa attempt', {
      attemptId: attempt.id,
      error: e.message,
    });
    return [];
  }
};

/**
 * Stage an attempt: validate the cart, hold the stock, park the cart.
 * Creates NO sale row. Returns the staged attempt; the caller does the STK
 * push and then calls attachCheckoutRequestId() with Safaricom's ID.
 */
export const stageAttempt = async ({
  userId,
  businessId,
  items,
  phone,
  customerName,
  customerType,
  note,
}) => {
  return db.transaction(async tx => {
    // Prices always come from the DB, never the client — and reading them
    // inside this transaction means the snapshot we park matches the stock
    // we're about to hold.
    const cart = await validateAndCalculateCart(userId, businessId, items, tx);

    for (const item of cart.items) {
      await reserveStockFIFO(item.product_id, item.quantity, tx, {
        referenceType: REF_TYPE,
        reason: `Held ${item.quantity} units for in-flight M-Pesa payment`,
      });
    }

    const [attempt] = await tx
      .insert(mpesaAttempts)
      .values({
        business_id: businessId,
        user_id: userId,
        checkout_request_id: localRef(),
        phone: phone || null,
        amount: String(cart.total_amount),
        cart_items: JSON.stringify(cart.items),
        customer_name: customerName || null,
        customer_type: customerType || 'walk_in',
        note: note || null,
        stock_reserved: 1,
        status: 'initiated',
      })
      .returning();

    logger.info('M-Pesa attempt staged — stock held, no sale row created', {
      attemptId: attempt.id,
      businessId,
      amount: cart.total_amount,
      items: cart.items.length,
    });

    return { attempt, cart };
  });
};

/**
 * Swap the placeholder key for Safaricom's real CheckoutRequestID.
 *
 * This is the one genuinely fragile moment in the flow: if the process dies
 * between a successful push and this update, the callback will arrive for an
 * ID we never recorded. That's why it runs immediately after the push and
 * logs at error level on failure — the attempt row still holds the cart and
 * the hold, so the payment is reconcilable by hand, and sweepStaleAttempts()
 * will release the stock either way.
 */
export const attachCheckoutRequestId = async (
  attemptId,
  checkoutRequestId,
  merchantRequestId = null
) => {
  const [updated] = await db
    .update(mpesaAttempts)
    .set({
      checkout_request_id: checkoutRequestId,
      merchant_request_id: merchantRequestId,
      updated_at: new Date(),
    })
    .where(eq(mpesaAttempts.id, attemptId))
    .returning();

  return updated;
};

/**
 * Abandon a staged attempt before any money moved — the STK push itself
 * failed, so the customer was never even prompted. Releases the hold.
 */
export const abandonAttempt = async (attemptId, reason) => {
  try {
    await db.transaction(async tx => {
      const [attempt] = await tx
        .select()
        .from(mpesaAttempts)
        .where(eq(mpesaAttempts.id, attemptId))
        .for('update')
        .limit(1);

      if (!attempt || attempt.status !== 'initiated') return;

      await releaseHold(attempt, tx, 'STK push failed');

      await tx
        .update(mpesaAttempts)
        .set({
          status: 'failed',
          result_desc: reason ? String(reason).slice(0, 500) : 'STK push failed',
          completed_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(mpesaAttempts.id, attempt.id));
    });
  } catch (e) {
    // Never let cleanup failure mask the original error the caller is
    // already reporting to the client.
    logger.error('Failed to abandon M-Pesa attempt', {
      attemptId,
      error: e.message,
    });
  }
};

/**
 * Release every product hold on an attempt, exactly once.
 *
 * stock_reserved is flipped to 0 in the SAME transaction as the releases, so
 * a duplicate callback racing the timeout sweep can't release twice: the
 * second one reads stock_reserved = 0 and does nothing.
 */
const releaseHold = async (attempt, tx, reason) => {
  if (attempt.stock_reserved !== 1) return false;

  for (const item of parseCart(attempt)) {
    await releaseStockReservation(item.product_id, item.quantity, tx, {
      referenceType: REF_TYPE,
      referenceId: attempt.id,
      reason: `Released M-Pesa hold on ${item.quantity} units — ${reason}`,
    });
  }

  await tx
    .update(mpesaAttempts)
    .set({ stock_reserved: 0, updated_at: new Date() })
    .where(eq(mpesaAttempts.id, attempt.id));

  return true;
};

/**
 * Apply a Safaricom callback to a staged attempt.
 *
 * Returns a plain descriptor for the caller to act on post-commit
 * (token/ledger record, notification) — those deliberately run outside this
 * transaction, as they did before, so a billing hiccup can't roll back a
 * sale the customer has already paid for.
 *
 *   { outcome: 'no_attempt' }            — nothing staged under this ID
 *   { outcome: 'duplicate', ... }        — already resolved; no-op
 *   { outcome: 'success', saleId, ... }  — sale created
 *   { outcome: 'failed', ... }           — hold released, zero rows in sales
 */
export const applyCallback = async ({
  checkoutRequestId,
  resultCode,
  resultDesc,
  amount,
  mpesaReceiptNumber,
  phoneNumber,
  rawPayload,
}) => {
  return db.transaction(async tx => {
    const [attempt] = await tx
      .select()
      .from(mpesaAttempts)
      .where(eq(mpesaAttempts.checkout_request_id, checkoutRequestId))
      .for('update')
      .limit(1);

    if (!attempt) return { outcome: 'no_attempt' };

    // Safaricom retries callbacks. The row lock above plus this check make
    // the whole handler idempotent.
    if (attempt.status !== 'initiated') {
      return {
        outcome: 'duplicate',
        attemptId: attempt.id,
        status: attempt.status,
        saleId: attempt.sale_id,
      };
    }

    const cart = parseCart(attempt);
    const payloadText = rawPayload ? JSON.stringify(rawPayload) : null;

    // ══════════════════════════════════════════
    // FAILED / CANCELLED — zero rows in `sales`
    // ══════════════════════════════════════════
    if (resultCode !== 0) {
      await releaseHold(attempt, tx, `payment failed (code ${resultCode})`);

      await tx
        .update(mpesaAttempts)
        .set({
          status: 'failed',
          result_code: resultCode ?? null,
          result_desc: resultDesc ? String(resultDesc).slice(0, 500) : null,
          callback_payload: payloadText,
          completed_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(mpesaAttempts.id, attempt.id));

      logger.info('M-Pesa attempt failed — no sale recorded, stock released', {
        attemptId: attempt.id,
        resultCode,
      });

      return {
        outcome: 'failed',
        attemptId: attempt.id,
        businessId: attempt.business_id,
        resultCode,
      };
    }

    // ══════════════════════════════════════════
    // SUCCESS — the hold becomes a real deduction, then the sale exists
    // ══════════════════════════════════════════
    const paidAmount = Number(amount ?? attempt.amount);
    const processedItems = [];
    let realizedProfit = 0;

    for (const item of cart) {
      // Release before deducting, both inside this transaction. The product
      // row is already write-locked by the release, so sellable stock never
      // momentarily appears to grow: reserved_quantity drops by qty and
      // current_quantity drops by the same qty before anyone else can read.
      if (attempt.stock_reserved === 1) {
        await releaseStockReservation(item.product_id, item.quantity, tx, {
          referenceType: REF_TYPE,
          referenceId: attempt.id,
          reason: 'M-Pesa payment confirmed — hold converted to sale',
        });
      }

      const deduction = await deductStockFIFO(item.product_id, item.quantity, tx);
      const totalCost = deduction.deductions.reduce(
        (sum, d) => sum + d.total_cost,
        0
      );
      const unitCost = item.quantity > 0 ? totalCost / item.quantity : 0;
      const lineTotal = Number(item.line_total ?? item.unit_price * item.quantity);
      const profit = lineTotal - totalCost;

      realizedProfit += profit;

      processedItems.push({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: Number(lineTotal.toFixed(2)),
        unit_cost: Number(unitCost.toFixed(4)),
        profit: Number(profit.toFixed(2)),
        deductions: deduction.deductions,
      });
    }

    if (attempt.stock_reserved === 1) {
      await tx
        .update(mpesaAttempts)
        .set({ stock_reserved: 0, updated_at: new Date() })
        .where(eq(mpesaAttempts.id, attempt.id));
    }

    const [sale] = await tx
      .insert(sales)
      .values({
        business_id: attempt.business_id,
        total_amount: String(attempt.amount),
        total_profit: String(Number(realizedProfit.toFixed(2))),
        payment_mode: 'mpesa',
        status: 'completed',
        payment_status: 'success',
        stk_request_id: checkoutRequestId,
        mpesa_transaction_id: mpesaReceiptNumber || null,
        mpesa_sender_phone: phoneNumber || attempt.phone || null,
        amount_paid: String(paidAmount.toFixed(2)),
        callback_payload: payloadText,
        customer_type: attempt.customer_type || 'walk_in',
        customer_name: attempt.customer_name || null,
        note: attempt.note || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    for (const item of processedItems) {
      await tx.insert(saleItems).values({
        sale_id: sale.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
        total_price: String(item.total_price),
        unit_cost: String(item.unit_cost),
        profit: String(item.profit),
        created_at: new Date(),
      });

      // Stock movements can only carry the sale id now that the sale exists,
      // which is the point of doing it in this order.
      for (const d of item.deductions) {
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

    await tx.insert(payments).values({
      sale_id: sale.id,
      stk_request_id: checkoutRequestId,
      mpesa_transaction_id: mpesaReceiptNumber || null,
      phone: phoneNumber || attempt.phone || null,
      amount: String(attempt.amount),
      status: 'success',
      callback_payload: payloadText,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Audit marker only — the real token deduction happens post-commit via
    // createRecord(), same as before.
    await tx.insert(walletTransactions).values({
      business_id: attempt.business_id,
      change_tokens: 0,
      type: 'charge',
      reference: String(sale.id),
      note: `M-Pesa sale #${sale.id} completed — ${mpesaReceiptNumber || 'no receipt'}`,
      created_at: new Date(),
      created_by: null,
    });

    await tx
      .update(mpesaAttempts)
      .set({
        status: 'success',
        result_code: 0,
        result_desc: resultDesc ? String(resultDesc).slice(0, 500) : null,
        mpesa_receipt: mpesaReceiptNumber || null,
        mpesa_sender_phone: phoneNumber || null,
        amount_paid: String(paidAmount.toFixed(2)),
        callback_payload: payloadText,
        sale_id: sale.id,
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(mpesaAttempts.id, attempt.id));

    logger.info('M-Pesa attempt confirmed — sale created', {
      attemptId: attempt.id,
      saleId: sale.id,
      receipt: mpesaReceiptNumber,
      amount: paidAmount,
      realizedProfit,
    });

    return {
      outcome: 'success',
      attemptId: attempt.id,
      saleId: sale.id,
      businessId: attempt.business_id,
      userId: attempt.user_id,
      amount: paidAmount,
      mpesaReceiptNumber: mpesaReceiptNumber || null,
      phoneNumber: phoneNumber || attempt.phone || null,
      items: processedItems.map(({ deductions: _deductions, ...rest }) => rest),
    };
  });
};

/**
 * Release stock held by attempts that never got a callback.
 *
 * Safaricom does send a timeout callback, but it isn't guaranteed to arrive —
 * and without this, one dropped callback would hold a unit off the shelf
 * forever. Marked 'timeout' rather than 'failed' so the two causes stay
 * distinguishable in reconciliation.
 */
export const sweepStaleAttempts = async (
  maxAgeMinutes = ATTEMPT_TIMEOUT_MINUTES
) => {
  try {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const stale = await db
      .select({ id: mpesaAttempts.id })
      .from(mpesaAttempts)
      .where(
        and(
          eq(mpesaAttempts.status, 'initiated'),
          lt(mpesaAttempts.created_at, cutoff)
        )
      );

    if (stale.length === 0) return { swept: 0 };

    let swept = 0;

    // One transaction per attempt: a single corrupt cart must not block the
    // rest of the sweep from freeing their stock.
    for (const { id } of stale) {
      try {
        await db.transaction(async tx => {
          const [attempt] = await tx
            .select()
            .from(mpesaAttempts)
            .where(eq(mpesaAttempts.id, id))
            .for('update')
            .limit(1);

          // A real callback may have landed while we were queuing.
          if (!attempt || attempt.status !== 'initiated') return;

          await releaseHold(attempt, tx, 'no callback received — timed out');

          await tx
            .update(mpesaAttempts)
            .set({
              status: 'timeout',
              result_desc: `No callback within ${maxAgeMinutes} minutes`,
              completed_at: new Date(),
              updated_at: new Date(),
            })
            .where(eq(mpesaAttempts.id, attempt.id));

          swept += 1;
        });
      } catch (e) {
        logger.error('Failed to sweep stale M-Pesa attempt', {
          attemptId: id,
          error: e.message,
        });
      }
    }

    if (swept > 0) {
      logger.info(`Swept ${swept} stale M-Pesa attempt(s) — stock released`);
    }

    return { swept };
  } catch (e) {
    logger.error('Error sweeping stale M-Pesa attempts', e);
    return { swept: 0, error: e.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SWEEPER LOOP
// ─────────────────────────────────────────────────────────────────────────────
// Runs far more often than the 6-hourly notification scan: held stock is
// unsellable, so a customer who walked away from the PIN prompt shouldn't
// keep a unit off the shelf for hours.

const SWEEP_INTERVAL_MS = parseInt(
  process.env.MPESA_SWEEP_INTERVAL_MS ?? '120000', // 2 min
  10
);

let sweepHandle = null;
let sweepInFlight = false;

export const startAttemptSweeper = () => {
  if (sweepHandle) return;

  sweepHandle = setInterval(async () => {
    // A slow sweep must not stack up behind itself.
    if (sweepInFlight) return;
    sweepInFlight = true;
    try {
      await sweepStaleAttempts();
    } catch (e) {
      logger.error('M-Pesa attempt sweeper failed', { error: e.message });
    } finally {
      sweepInFlight = false;
    }
  }, SWEEP_INTERVAL_MS);

  sweepHandle.unref?.();
  logger.info(
    `M-Pesa attempt sweeper started (every ${SWEEP_INTERVAL_MS / 1000}s, timeout ${ATTEMPT_TIMEOUT_MINUTES}m)`
  );
};

export const stopAttemptSweeper = () => {
  if (!sweepHandle) return;
  clearInterval(sweepHandle);
  sweepHandle = null;
  logger.info('M-Pesa attempt sweeper stopped');
};

/**
 * Attempts for a business — payment history including the ones that never
 * became sales. This is where a failed payment now lives instead of in the
 * sales table.
 */
export const getAttemptsForBusiness = async (businessId, options = {}) => {
  const { limit = 50, statuses = null } = options;

  const conditions = [eq(mpesaAttempts.business_id, businessId)];
  if (Array.isArray(statuses) && statuses.length > 0) {
    conditions.push(inArray(mpesaAttempts.status, statuses));
  }

  return db
    .select()
    .from(mpesaAttempts)
    .where(and(...conditions))
    .orderBy(sql`${mpesaAttempts.created_at} DESC`)
    .limit(limit);
};
