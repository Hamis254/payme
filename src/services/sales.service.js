/**
 * =============================================================================
 * SERVICE: SALES ENGINE
 * =============================================================================
 * Stock and money now run on two different clocks, on purpose:
 *
 *  - cash / credit → goods leave immediately (FIFO deducted now).
 *    Cash realizes profit immediately (money is in hand).
 *    Credit realizes NOTHING at creation — it opens as a debt.
 *
 *  - hire_purchase → goods do NOT leave the shop. Stock is only
 *    RESERVED (held, unsellable) at signing. Real FIFO deduction and
 *    real cost/profit are only computed once the agreement is fully
 *    paid off — see higherPurchase.service.js (should_deduct_stock).
 *
 *  - mpesa → createSale() is NOT used at all. An STK push creates no sale;
 *    it stages an attempt in mpesa_attempts with the stock reserved, and
 *    the sale row is only born in the callback on confirmed payment. See
 *    mpesaAttempt.service.js. (This file used to open a 'pending' sale at
 *    push time and patch it later, which left failed payment attempts
 *    sitting permanently in `sales` — createSale now rejects 'mpesa'
 *    outright so that path can't come back by accident.)
 *
 * sales.total_profit means REALIZED profit only — full for cash and for
 * confirmed M-Pesa, 0 at creation for credit/hire_purchase (never updated
 * afterward; realized profit from those lives on creditPayments/
 * hirePurchaseInstallmentPayments, dated by when the money actually
 * landed — see getStatementFinancials).
 *
 * `records`/`record_items` (record.service.js) is a secondary, manual
 * ledger — NOT authoritative for stock, cost, or profit. Statement
 * generation (getStatementFinancials, below) reads from THIS file's
 * tables directly, never from the records mirror.
 *
 * All profit/ledger math is delegated to financialCalculations.js —
 * this file's job is fetching/writing rows, not deciding what counts
 * as profit.
 *
 * IMPORTANT — this file uses NAMED exports throughout. Anything
 * importing from here (payme.controller.js, sales.controller.js,
 * record.service.js, analytics.service.js) must import specific names,
 * e.g. `import { createSale, getStatementFinancials } from
 * '#services/sales.service.js'` — NOT `import * as saleService from
 * '#services/sales.service.js'`. Mixing the two import styles is what
 * caused every function call in payme.controller.js to throw
 * ReferenceErrors earlier — keep this consistent everywhere this file
 * is imported.
 *
 * @module services/sales.service
 * =============================================================================
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { sales, saleItems } from '#models/sales.model.js';
import { products, stockMovements } from '#models/stock.model.js';
import { businesses } from '#models/setting.model.js';
import { eq, and, desc, gte, lte, inArray, sql } from 'drizzle-orm';
import {
  checkStockAvailability,
  deductStockFIFO,
  reserveStockFIFO,
} from '#services/stock.service.js';
import { creditAccounts, creditPayments } from '#models/credit.model.js';
import {
  hirePurchaseAgreements,
  hirePurchaseInstallmentPayments,
} from '#models/higherPurchase.model.js';
import { spoiledStock } from '#models/spoiledStock.model.js';
import { expenses as expensesTable } from '#models/expense.model.js';
import {
  calculateCreditSaleOpening,
  calculateHPAgreementOpening,
  calculateExpenseImpact,
} from '#services/financialCalculations.js';

import { emitNotification, notifications } from '#utils/notificationEmitter.js';
import { checkAndNotifyLowStock } from '#services/stock.service.js';

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Validate cart items against the DB and calculate totals.
 * Prices are always read from DB — frontend never sends prices.
 *
 * Accepts an optional `trx` so processPayMe's outer transaction (cash/
 * credit/hire_purchase) is the one actually doing every read here too —
 * without this, a cart validated outside the transaction could read
 * stock levels that the transaction itself is about to change.
 */
export const validateAndCalculateCart = async (userId, businessId, items, trx = null) => {
  try {
    const client = trx || db;

    const [business] = await client
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const validatedItems = [];
    let totalAmount = 0;

    for (const item of items) {
      const [product] = await client
        .select()
        .from(products)
        .where(and(eq(products.id, item.product_id), eq(products.business_id, businessId)))
        .limit(1);

      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      // Expired / deactivated goods must not be sellable.
      //
      // sweepExpiredProducts() moves expired stock into spoiled_stock, but it
      // runs lazily — only when someone opens a stock or inventory list. Until
      // that happens the product still carries its full current_quantity and
      // passes the availability check below, so expired goods could be sold.
      // (At the time of writing, 4 products were past expiry and still
      // is_active in production.) Checking here closes that window regardless
      // of whether the sweep has run yet.
      if (product.is_active !== 1) {
        throw new Error(`${product.name} is no longer active and cannot be sold.`);
      }

      if (product.expiry_date && new Date(product.expiry_date) < new Date()) {
        throw new Error(
          `${product.name} expired on ${new Date(product.expiry_date).toDateString()} ` +
            'and cannot be sold. Record it as spoiled stock to clear it from inventory.'
        );
      }

      // checkStockAvailability already accepts an optional trx — pass it
      // through so this read is inside the same transaction too.
      const stockCheck = await checkStockAvailability(item.product_id, item.quantity, client);

      if (!stockCheck.available) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${stockCheck.total_available}, Requested: ${item.quantity}`
        );
      }

      const unitPrice = Number(product.selling_price_per_unit);
      const unitCost = Number(product.buying_price_per_unit);
      const lineTotal = unitPrice * item.quantity;

      validatedItems.push({
        product_id: item.product_id,
        product_name: product.name,
        unit: product.unit,
        quantity: item.quantity,
        unit_price: unitPrice,
        catalog_unit_cost: unitCost,
        line_total: Number(lineTotal.toFixed(2)),
        stock_available: stockCheck.total_available,
      });

      totalAmount += lineTotal;
    }

    return {
      business,
      items: validatedItems,
      total_amount: Number(totalAmount.toFixed(2)),
      items_count: validatedItems.length,
    };
  } catch (e) {
    logger.error('Error validating cart', e);
    throw e;
  }
};

/**
 * Create a sale. Accepts an optional `trx` as the 6th argument.
 * Every read/write on the critical path — cart validation, FIFO
 * deduction, stock reservation, stock movement logging, the sale row,
 * and the sale_items rows — runs through that SAME transaction when one
 * is supplied, so a failure anywhere after this function (the credit/HP
 * record, the token ledger entry) correctly rolls back the stock
 * changes made here too. Called without a trx (e.g. mpesa, which
 * intentionally manages its own commit timing via the callback), it
 * behaves as before — opens no transaction of its own, runs against the
 * default `db` client.
 *
 * Behaviour branches three ways:
 *
 *   cash / credit → deduct stock via FIFO NOW (goods physically leave).
 *                    cash realizes profit immediately.
 *                    credit realizes ZERO profit — it's a debt, opened
 *                    negative on the ledger (calculateCreditSaleOpening).
 *
 *   hire_purchase → RESERVE stock (hold, don't sell to anyone else).
 *                    No FIFO deduction, no cost, no profit yet — all of
 *                    that is unknown until the agreement is paid off.
 *                    Ledger opens negative too (calculateHPAgreementOpening).
 *
 *   mpesa         → REJECTED. Sales are not created before payment is
 *                    confirmed — see mpesaAttempt.service.js.
 */
export const createSale = async (userId, businessId, items, paymentMode, options = {}, trx = null) => {
  try {
    // Guard, not a branch: an M-Pesa sale must not exist until Safaricom
    // confirms the money. Everything that used to reach here for 'mpesa'
    // now goes through stageAttempt() → applyCallback() instead.
    if (paymentMode === 'mpesa') {
      throw new Error(
        'createSale() does not handle M-Pesa. Stage an attempt via ' +
          'mpesaAttempt.service.js — the sale is created by the callback ' +
          'once payment is confirmed.'
      );
    }

    const client = trx || db;
    const cartValidation = await validateAndCalculateCart(userId, businessId, items, trx);

    const processedItems = [];
    let realizedProfit = 0; // ONLY cash contributes here at creation time

    for (const item of items) {
      const validatedItem = cartValidation.items.find(i => i.product_id === item.product_id);
      const totalPrice = validatedItem.unit_price * item.quantity;

      let unitCost = 0;
      let profit = 0; // per-item profit — realized for cash, 0 (pending) otherwise

      if (paymentMode === 'cash' || paymentMode === 'credit') {
        // Goods leave the shop now — real FIFO cost, real money math.
        const deduction = await deductStockFIFO(item.product_id, item.quantity, trx);
        const totalCost = deduction.deductions.reduce((sum, d) => sum + d.total_cost, 0);
        unitCost = deduction.deductions.length > 0 ? totalCost / item.quantity : 0;
        // accrual profit for this item — always stored, whether or not
        // it's realized yet (credit isn't)
        profit = totalPrice - totalCost;

        for (const d of deduction.deductions) {
          await client.insert(stockMovements).values({
            product_id: item.product_id,
            batch_id: d.batch_id,
            type: 'sale',
            quantity_change: String(-d.quantity),
            unit_cost: String(d.unit_cost),
            reference_type: 'sale',
            reason: `${paymentMode} sale - FIFO batch ${d.batch_id || 'current'}`,
          });
        }

        if (paymentMode === 'cash') {
          realizedProfit += profit; // cash: money's in hand, profit counts now
        }
        // credit: profit computed and stored for reference/accrual reporting,
        // but NOT added to realizedProfit — see calculateCreditSaleOpening below
      } else if (paymentMode === 'hire_purchase') {
        // Goods stay in the shop — reserve, don't deduct. Cost/profit are
        // genuinely unknown until final payment triggers real FIFO
        // deduction (higherPurchase.service.js sets should_deduct_stock).
        await reserveStockFIFO(item.product_id, item.quantity, trx);
        unitCost = 0;
        profit = 0;
      } else {
        // Unreachable for the four valid modes now that 'mpesa' is rejected
        // above — kept as a safe default so an unrecognised mode records no
        // fabricated cost or profit rather than guessing.
        unitCost = 0;
        profit = 0;
      }

      processedItems.push({
        product_id: item.product_id,
        product_name: validatedItem.product_name,
        quantity: item.quantity,
        unit_price: validatedItem.unit_price,
        total_price: Number(totalPrice.toFixed(2)),
        unit_cost: Number(unitCost.toFixed?.(4) ?? unitCost),
        profit: Number(profit.toFixed(2)),
      });
    }

    // Low-stock check only applies where stock actually moved right now.
    // NOTE: still reads via the default `db` client, not `trx` — inside
    // an uncommitted transaction it can momentarily read pre-deduction
    // quantities (Postgres read-committed visibility). Not a money-
    // correctness issue, just a possible missed/delayed low-stock alert
    // on the current request.
    if (paymentMode === 'cash' || paymentMode === 'credit') {
      for (const item of processedItems) {
        await checkAndNotifyLowStock(businessId, item.product_id);
      }
    }

    // ── Ledger opening entry for credit / hire_purchase ──────────────
    // Full sale value shown NEGATIVE — a debt, not revenue — until real
    // money lands. This is what stops the statement from ever printing
    // an unpaid amount as if it were collected.
    let ledgerOpening = null;
    if (paymentMode === 'credit') {
      ledgerOpening = calculateCreditSaleOpening({ totalSaleValue: cartValidation.total_amount });
    } else if (paymentMode === 'hire_purchase') {
      ledgerOpening = calculateHPAgreementOpening({ totalSaleValue: cartValidation.total_amount });
    }

    // sales.total_profit is REALIZED profit only — real money terms.
    // cash: full profit now. mpesa: 0 (backfilled on callback).
    // credit / hire_purchase: 0 — nothing's realized until repayments
    // /installments come in (credit.service.js / higherPurchase.service.js).
    const finalRealizedProfit = paymentMode === 'cash' ? realizedProfit : 0;

    const [sale] = await client
      .insert(sales)
      .values({
        business_id: businessId,
        total_amount: String(cartValidation.total_amount),
        total_profit: String(Number(finalRealizedProfit.toFixed(2))),
        payment_mode: paymentMode,
        // cash / credit: goods are physically out → completed immediately.
        // hire_purchase: goods are RESERVED, not out — still "completed" as
        // a transaction record, but stock status is tracked separately via
        // hirePurchaseAgreements.status, not sales.status.
        status: ['cash', 'credit', 'hire_purchase'].includes(paymentMode)
          ? 'completed'
          : 'pending',
        // payment_status reflects MONEY, not goods — this is the field that
        // must never say "paid" for credit/hire_purchase at creation.
        payment_status: paymentMode === 'cash' ? 'paid' : 'unpaid',
        customer_type: options.customer_type || 'walk_in',
        customer_id: options.customer_id || null,
        customer_name: options.customer_name || null,
        note: options.note || null,
        mpesa_sender_phone: options.customer_phone || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    if (paymentMode === 'cash') {
      await emitNotification({
        user_id: userId,
        business_id: businessId,
        ...notifications.paymentComplete({
          amount: cartValidation.total_amount,
          sale_id: sale.id,
          phone: options.customer_phone || null,
        }),
      });
    }

    for (const item of processedItems) {
      await client.insert(saleItems).values({
        sale_id: sale.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
        total_price: String(item.total_price),
        unit_cost: String(item.unit_cost),
        profit: String(item.profit), // accrual/reference profit — see note above
        created_at: new Date(),
      });
    }

    logger.info(
      `Sale created: ${sale.id} — business ${businessId}, mode: ${paymentMode}, total: ${cartValidation.total_amount}, realized_profit: ${finalRealizedProfit}`
    );

    return {
      sale: {
        id: sale.id,
        business_id: sale.business_id,
        total_amount: Number(sale.total_amount),
        realized_profit: Number(sale.total_profit),
        payment_mode: sale.payment_mode,
        payment_status: sale.payment_status,
        status: sale.status,
        customer_type: sale.customer_type,
        customer_name: sale.customer_name,
        created_at: sale.created_at,
      },
      items: processedItems,
      ledger_opening: ledgerOpening, // { ledger_entry: -amount, ledger_tag } or null for cash/mpesa
      summary: {
        items_count: processedItems.length,
        total_amount: cartValidation.total_amount,
        realized_profit: Number(finalRealizedProfit.toFixed(2)),
        accrual_profit: Number(
          processedItems.reduce((s, i) => s + i.profit, 0).toFixed(2)
        ), // full projected margin, whether collected or not — for reference only
      },
    };
  } catch (e) {
    logger.error('Error creating sale', e);
    throw e;
  }
};

/**
 * Update a sale's status. No money-timing logic lives here, just a
 * status/reference update.
 *
 * DEAD as of the M-Pesa restructure — it existed for the callback flow,
 * which no longer updates a pre-existing sale row (there isn't one until
 * payment is confirmed). Kept rather than deleted only because it's an
 * exported symbol and harmless; it currently has zero call sites in src/.
 */
export const updateSaleStatus = async (saleId, status, mpesaData = {}) => {
  try {
    const updateData = { status, updated_at: new Date() };

    if (mpesaData.transaction_id) updateData.mpesa_transaction_id = mpesaData.transaction_id;
    if (mpesaData.sender_name) updateData.mpesa_sender_name = mpesaData.sender_name;
    if (mpesaData.sender_phone) updateData.mpesa_sender_phone = mpesaData.sender_phone;

    const [updated] = await db.update(sales).set(updateData).where(eq(sales.id, saleId)).returning();

    logger.info(`Sale ${saleId} status updated to ${status}`);
    return updated;
  } catch (e) {
    logger.error('Error updating sale status', e);
    throw e;
  }
};

/**
 * Get all sales for a business (with totals). total_profit summed here
 * now naturally means REALIZED profit only, since that's what
 * sales.total_profit means post-fix (0 for credit/HP at creation).
 */
export const getSalesForBusiness = async (userId, businessId, options = {}) => {
  try {
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    let query = db.select().from(sales).where(eq(sales.business_id, businessId)).orderBy(desc(sales.created_at));

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const salesList = await query;

    let totalRevenue = 0;
    let totalProfit = 0;

    for (const sale of salesList) {
      if (sale.status === 'completed') {
        totalRevenue += Number(sale.total_amount);
        totalProfit += Number(sale.total_profit);
      }
    }

    return {
      sales: salesList,
      count: salesList.length,
      totals: {
        total_revenue: Number(totalRevenue.toFixed(2)),
        total_profit: Number(totalProfit.toFixed(2)),
      },
    };
  } catch (e) {
    logger.error('Error getting sales', e);
    throw e;
  }
};

/**
 * Get every sale item across a business, flattened one row per product
 * per sale, with sale-level context attached to each row.
 */
export const getSaleItemsForBusiness = async (userId, businessId, options = {}) => {
  try {
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    let query = db
      .select({
        id: saleItems.id,
        sale_id: saleItems.sale_id,
        product_id: saleItems.product_id,
        product_name: saleItems.product_name,
        quantity: saleItems.quantity,
        unit_price: saleItems.unit_price,
        total_price: saleItems.total_price,
        profit: saleItems.profit,
        payment_mode: sales.payment_mode,
        status: sales.status,
        payment_status: sales.payment_status,
        customer_name: sales.customer_name,
        mpesa_transaction_id: sales.mpesa_transaction_id,
        created_at: sales.created_at,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.sale_id, sales.id))
      .where(eq(sales.business_id, businessId))
      .orderBy(desc(sales.created_at));

    if (options.limit) query = query.limit(options.limit);
    if (options.offset) query = query.offset(options.offset);

    const rows = await query;

    return { items: rows, count: rows.length };
  } catch (e) {
    logger.error('Error getting sale items for business', e);
    throw e;
  }
};

/**
 * Get a single sale with all its items.
 */
export const getSaleById = async (userId, saleId) => {
  try {
    const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);

    if (!sale) throw new Error('Sale not found');

    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, sale.business_id), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Sale not found or access denied');

    const items = await db
      .select({
        id: saleItems.id,
        product_id: saleItems.product_id,
        product_name: saleItems.product_name,
        quantity: saleItems.quantity,
        unit_price: saleItems.unit_price,
        total_price: saleItems.total_price,
        unit_cost: saleItems.unit_cost,
        profit: saleItems.profit,
      })
      .from(saleItems)
      .where(eq(saleItems.sale_id, saleId));

    return {
      sale,
      items,
      business_name: business.name,
    };
  } catch (e) {
    logger.error('Error getting sale', e);
    throw e;
  }
};

/**
 * Full statement financials for a date range — the single source of
 * truth. Dashboard, trends, the daily sales ledger, and
 * record.service.js all read from this. Never reads from the `records`
 * mirror table.
 */
export const getStatementFinancials = async (businessId, startDate, endDate) => {
  if (!businessId || !Number.isInteger(Number(businessId)) || Number(businessId) <= 0) {
    throw new Error(`Invalid business ID: "${businessId}". Expected a positive whole number.`);
  }
  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) {
    throw new Error(`Invalid start date passed to getStatementFinancials: "${startDate}".`);
  }
  if (!(endDate instanceof Date) || isNaN(endDate.getTime())) {
    throw new Error(`Invalid end date passed to getStatementFinancials: "${endDate}".`);
  }

  try {
    const ledgerRows = [];

    // ─────────────────────────────────────────────────────────────
    // 1. CASH & M-PESA — real, completed sales. Money in hand the
    //    day they happened; profit is real FIFO profit, already
    //    realized (backfilled for mpesa at callback confirmation).
    // ─────────────────────────────────────────────────────────────
    const cashMpesaSales = await db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          inArray(sales.payment_mode, ['cash', 'mpesa']),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      );

    const cashMpesaSaleIds = cashMpesaSales.map(s => s.id);
    const cashMpesaItems = cashMpesaSaleIds.length
      ? await db.select().from(saleItems).where(inArray(saleItems.sale_id, cashMpesaSaleIds))
      : [];

    const itemsBySale = {};
    cashMpesaItems.forEach(item => (itemsBySale[item.sale_id] ??= []).push(item));

    let cashTotal = 0, mpesaTotal = 0, cashCount = 0, mpesaCount = 0;
    let cashMpesaProfit = 0, cashMpesaCogs = 0;

    cashMpesaSales.forEach(sale => {
      const amount = Number(sale.total_amount);
      const items = itemsBySale[sale.id] || [];

      if (sale.payment_mode === 'cash') { cashTotal += amount; cashCount++; }
      else { mpesaTotal += amount; mpesaCount++; }

      items.forEach(item => {
        const cost = Number(item.unit_cost) * Number(item.quantity);
        cashMpesaCogs += cost;
        cashMpesaProfit += Number(item.profit);
        ledgerRows.push({
          product: item.product_name || `Product #${item.product_id}`,
          qty: `${Number(item.quantity)} units`,
          type: sale.payment_mode.toUpperCase(),
          method: sale.payment_mode.toUpperCase(),
          customer: sale.customer_name || 'Walk-in',
          phone: sale.mpesa_sender_phone || '—',
          tx_id: sale.mpesa_transaction_id || '—',
          time: sale.created_at,
          amount: Number(item.total_price), // real cash, positive
        });
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 2. CREDIT SALES OPENED in range — a debt, shown NEGATIVE.
    //    Nothing collected yet; goods already left (FIFO already ran
    //    in createSale), so cost is real, but it's not an "expense"
    //    — it's a receivable. Never subtracted as cash out.
    // ─────────────────────────────────────────────────────────────
    const creditSalesOpened = await db
      .select({
        sale_id: sales.id,
        total_amount: sales.total_amount,
        created_at: sales.created_at,
        customer_name: sales.customer_name,
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.payment_mode, 'credit'),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      );

    let creditGivenPeriod = 0;
    let creditCogs = 0;

    const creditSaleIds = creditSalesOpened.map(s => s.sale_id);
    const creditItems = creditSaleIds.length
      ? await db.select().from(saleItems).where(inArray(saleItems.sale_id, creditSaleIds))
      : [];
    const creditItemsBySale = {};
    creditItems.forEach(item => (creditItemsBySale[item.sale_id] ??= []).push(item));

    creditSalesOpened.forEach(s => {
      const amount = Number(s.total_amount);
      creditGivenPeriod += amount;

      const items = creditItemsBySale[s.sale_id] || [];
      const saleCost = items.reduce((sum, item) => sum + Number(item.unit_cost) * Number(item.quantity), 0);
      creditCogs += saleCost;

      ledgerRows.push({
        product: `Credit sale — ${s.customer_name || 'customer'}`,
        qty: `${items.length} item${items.length === 1 ? '' : 's'}`,
        type: 'CREDIT_PENDING',
        method: 'CREDIT',
        customer: s.customer_name || 'Walk-in',
        phone: '—',
        tx_id: '—',
        time: s.created_at,
        amount: -amount, // not received — written negative on purpose
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 3. CREDIT REPAYMENTS received in range — real cash, positive,
    //    dated the day it actually landed. Profit realized comes
    //    straight from what credit.service.js already computed
    //    cost-recovery-first, per payment — no re-derivation here.
    // ─────────────────────────────────────────────────────────────
    const creditRepaymentsInRange = await db
      .select({
        amount: creditPayments.amount,
        profit_realized: creditPayments.profit_realized,
        created_at: creditPayments.created_at,
        payment_method: creditPayments.payment_method,
        mpesa_transaction_id: creditPayments.mpesa_transaction_id,
        customer_name: creditAccounts.customer_name,
      })
      .from(creditPayments)
      .innerJoin(creditAccounts, eq(creditPayments.account_id, creditAccounts.id))
      .where(
        and(
          eq(creditAccounts.business_id, businessId),
          gte(creditPayments.created_at, startDate),
          lte(creditPayments.created_at, endDate)
        )
      );

    let creditRepaidPeriod = 0, creditProfitRealized = 0;
    creditRepaymentsInRange.forEach(p => {
      const amount = Number(p.amount);
      creditRepaidPeriod += amount;
      creditProfitRealized += Number(p.profit_realized);
      ledgerRows.push({
        product: 'Credit repayment',
        qty: '—',
        type: 'CREDIT_REPAYMENT',
        method: (p.payment_method || 'credit').toUpperCase(),
        customer: p.customer_name || 'Walk-in',
        phone: '—',
        tx_id: p.mpesa_transaction_id || '—',
        time: p.created_at,
        amount,
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 4. HP AGREEMENTS OPENED in range — same debt treatment as
    //    credit. Goods have NOT left the shop (reserved, not
    //    deducted), so there's no cost/profit line here at all —
    //    just the negative "not yet received" marker.
    // ─────────────────────────────────────────────────────────────
    const hpAgreementsOpened = await db
      .select({
        sale_id: hirePurchaseAgreements.sale_id,
        total_amount: hirePurchaseAgreements.total_amount,
        created_at: hirePurchaseAgreements.created_at,
        customer_name: creditAccounts.customer_name,
      })
      .from(hirePurchaseAgreements)
      .innerJoin(creditAccounts, eq(hirePurchaseAgreements.account_id, creditAccounts.id))
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          gte(hirePurchaseAgreements.created_at, startDate),
          lte(hirePurchaseAgreements.created_at, endDate)
        )
      );

    let hpGivenPeriod = 0;
    hpAgreementsOpened.forEach(a => {
      const amount = Number(a.total_amount);
      hpGivenPeriod += amount;
      ledgerRows.push({
        product: `Hire purchase agreement #${a.sale_id}`,
        qty: '—',
        type: 'HP_PENDING',
        method: 'HIRE_PURCHASE',
        customer: a.customer_name || 'Walk-in',
        phone: '—',
        tx_id: '—',
        time: a.created_at,
        amount: -amount,
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 5. HP DEPOSITS & INSTALLMENTS received in range — real cash,
    //    positive, dated the day received. Uses the append-only
    //    payments log so partial-payment history is never lost.
    // ─────────────────────────────────────────────────────────────
    const hpPaymentsInRange = await db
      .select({
        amount: hirePurchaseInstallmentPayments.amount,
        payment_type: hirePurchaseInstallmentPayments.payment_type,
        profit_realized: hirePurchaseInstallmentPayments.profit_realized,
        payment_date: hirePurchaseInstallmentPayments.payment_date,
        payment_method: hirePurchaseInstallmentPayments.payment_method,
        mpesa_transaction_id: hirePurchaseInstallmentPayments.mpesa_transaction_id,
        customer_name: creditAccounts.customer_name,
      })
      .from(hirePurchaseInstallmentPayments)
      .innerJoin(hirePurchaseAgreements, eq(hirePurchaseInstallmentPayments.agreement_id, hirePurchaseAgreements.id))
      .innerJoin(creditAccounts, eq(hirePurchaseAgreements.account_id, creditAccounts.id))
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          gte(hirePurchaseInstallmentPayments.payment_date, startDate),
          lte(hirePurchaseInstallmentPayments.payment_date, endDate)
        )
      );

    let hpDepositsTotal = 0, hpInstallmentsTotal = 0, hpProfitRealized = 0;
    hpPaymentsInRange.forEach(p => {
      const amount = Number(p.amount);
      if (p.payment_type === 'deposit') hpDepositsTotal += amount;
      else hpInstallmentsTotal += amount;
      hpProfitRealized += Number(p.profit_realized);
      ledgerRows.push({
        product: p.payment_type === 'deposit' ? 'HP deposit' : 'HP installment',
        qty: '—',
        type: p.payment_type === 'deposit' ? 'HP_DEPOSIT' : 'HP_INSTALLMENT',
        method: (p.payment_method || 'hire_purchase').toUpperCase(),
        customer: p.customer_name || 'Walk-in',
        phone: '—',
        tx_id: p.mpesa_transaction_id || '—',
        time: p.payment_date,
        amount,
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 6. EXPENSES — from the real `expenses` table, split petty
    //    (category 'other': lunch, airtime — hits today's till
    //    directly) vs everything else (operating expenses: rent,
    //    salaries, etc. — excluded from cash-in-hand, still counted
    //    in the period's true bottom line below).
    // ─────────────────────────────────────────────────────────────
    const expenseRecords = await db
      .select()
      .from(expensesTable)
      .where(
        and(
          eq(expensesTable.business_id, businessId),
          gte(expensesTable.expense_date, startDate),
          lte(expensesTable.expense_date, endDate)
        )
      );

    let pettyExpensesTotal = 0, operatingExpensesTotal = 0;
    expenseRecords.forEach(r => {
      // Which side of the till this lands on is Function 4's rule, not
      // this file's — routing through it keeps the statement's petty/
      // operating split from drifting away from the ledger tag.
      const impact = calculateExpenseImpact({
        category: r.category,
        amount: r.amount,
      });

      if (impact.hits_daily_cash) pettyExpensesTotal += impact.amount;
      else operatingExpensesTotal += impact.amount;

      ledgerRows.push({
        product: r.description || r.category,
        qty: '—',
        type: impact.ledger_tag,
        method: (r.payment_method || 'expense').toUpperCase(),
        phone: '—',
        tx_id: r.payment_reference || '—',
        time: r.expense_date,
        amount: -impact.amount,
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 7. SPOILED STOCK — real inventory loss, always reduces the
    //    true bottom line; never touches cash-in-hand (no cash moved).
    // ─────────────────────────────────────────────────────────────
    const [spoiledResult] = await db
      .select({ total: sql`COALESCE(SUM(${spoiledStock.total_loss_value}), 0)` })
      .from(spoiledStock)
      .where(
        and(
          eq(spoiledStock.business_id, businessId),
          gte(spoiledStock.created_at, startDate),
          lte(spoiledStock.created_at, endDate)
        )
      );
    const spoiledTotal = Number(spoiledResult?.total || 0);

    // ─────────────────────────────────────────────────────────────
    // 8. RECEIVABLES — all-time outstanding, informational. What's
    //    still owed, never counted as revenue or profit until it's
    //    actually collected (rows 3 and 5 above).
    // ─────────────────────────────────────────────────────────────
    const [creditOutstandingResult] = await db
      .select({ total: sql`COALESCE(SUM(${creditAccounts.balance_due}), 0)` })
      .from(creditAccounts)
      .where(eq(creditAccounts.business_id, businessId));

    const [hpOutstandingResult] = await db
      .select({ total: sql`COALESCE(SUM(${hirePurchaseAgreements.balance_remaining}), 0)` })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    // ─────────────────────────────────────────────────────────────
    // BOTTOM LINE — three figures, each answering a different
    // question, never blended into one:
    // ─────────────────────────────────────────────────────────────
    const totalCogs = round2(cashMpesaCogs + creditCogs);

    const cashCollected = round2(
      cashTotal + mpesaTotal + creditRepaidPeriod + hpDepositsTotal + hpInstallmentsTotal
    );
    const cashInHand = round2(cashCollected - pettyExpensesTotal);

    const realizedProfit = round2(
      cashMpesaProfit + creditProfitRealized + hpProfitRealized - pettyExpensesTotal
    );
    const netProfitForPeriod = round2(realizedProfit - operatingExpensesTotal - spoiledTotal);

    const accrualGoodsSoldValue = round2(cashTotal + mpesaTotal + creditGivenPeriod + hpGivenPeriod);

    ledgerRows.sort((a, b) => new Date(a.time) - new Date(b.time));

    return {
      ledgerRows,
      totals: {
        // Real money, today-terms
        cash_sales: round2(cashTotal),
        mpesa_sales: round2(mpesaTotal),
        credit_repaid_period: round2(creditRepaidPeriod),
        hp_deposits_period: round2(hpDepositsTotal),
        hp_installments_period: round2(hpInstallmentsTotal),
        cash_collected: cashCollected,
        petty_expenses: round2(pettyExpensesTotal),
        cash_in_hand: cashInHand,

        // Debts opened this period — informational, never in cash_collected
        credit_given_period: round2(creditGivenPeriod),
        hp_given_period: round2(hpGivenPeriod),

        // True profit, cost-recovery-first
        realized_profit: realizedProfit,
        operating_expenses: round2(operatingExpensesTotal),
        spoiled_total: round2(spoiledTotal),
        net_profit_for_period: netProfitForPeriod,

        // Accrual reference figures — NOT cash, NOT profit; business-
        // volume view of everything sold/agreed this period
        accrual_goods_sold_value: accrualGoodsSoldValue,
        total_cogs: totalCogs,          // includes cash, mpesa, AND credit COGS
        credit_cogs: round2(creditCogs), // broken out for transparency

        // Outstanding, all-time
        credit_outstanding: Number(creditOutstandingResult?.total || 0),
        hp_outstanding: Number(hpOutstandingResult?.total || 0),
        total_receivables: round2(
          Number(creditOutstandingResult?.total || 0) + Number(hpOutstandingResult?.total || 0)
        ),

        // Counts
        cash_count: cashCount,
        mpesa_count: mpesaCount,
        credit_sales_opened_count: creditSalesOpened.length,
        hp_agreements_opened_count: hpAgreementsOpened.length,
      },
    };
  } catch (e) {
    logger.error('Error computing statement financials', {
      error: e.message,
      businessId,
      startDate,
      endDate,
    });
    throw e;
  }
};