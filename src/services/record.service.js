/**
 * =============================================================================
 * SERVICE: RECORDS (manual ledger + statement aggregation)
 * =============================================================================
 * `records` is the manual, token-metered ledger — one token per entry,
 * created by hand via createRecord(). It is a DIFFERENT thing from the
 * operational tables (sales, creditPayments, hirePurchaseInstallments)
 * that credit.service.js / higherPurchase.service.js / sales.service.js
 * write to automatically. getRecords() merges `records` with an
 * auto-derived view of `sales` for the Records screen, but does NOT
 * currently include credit repayments or HP installments recorded
 * through the operational flow — flagged previously as a product
 * decision to make later, not a bug fixed here.
 *
 * calculateTotals() and getDashboardInsights() no longer read from
 * `records` at all — they were the fourth of four disagreeing profit
 * calculators found in this codebase, and were computing totals from a
 * mostly-empty-unless-manually-filled table instead of real sales data.
 * Both now defer to getStatementFinancials() / getDailyTrend() /
 * getMonthlyTrend() — the same source of truth as the dashboard and the
 * downloadable statement.
 *
 * Google Sheets sync has been removed from createRecord() — no longer
 * in use.
 * =============================================================================
 */

import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { startOfBusinessDay, endOfBusinessDay } from '#utils/businessDay.js';
import { db } from '#config/database.js';
import { records, record_items } from '#models/record.model.js';
import { sales } from '#models/sales.model.js';
import {
  spendTokens,
  InsufficientTokensError,
} from '#services/tokenLots.service.js';
import logger from '#config/logger.js';
import { mergeFinancialRecords, applyRecordFilters } from '#utils/recordAggregation.js';
import { getStatementFinancials } from '#services/sales.service.js';
import { getDailyTrend, getMonthlyTrend } from '#services/analytics.service.js';

/**
 * CREATE RECORD: With atomic token deduction (Revenue Guard)
 * Ensures 1 token deduction and 1 record creation both succeed or both fail.
 */
export async function createRecord(
  {
    business_id,
    user_id,
    type,
    category,
    amount,
    transaction_date,
    items = [],
    payment_method,
    mpesa_data = null,
    reference_id = null,
    description = null,
    product_id = null,
    credit_due_date = null,
    credit_status = type === 'credit' ? 'pending' : null,
  },
  trx = null
) {
  try {
    if (!['sales', 'hp', 'credit', 'inventory', 'expense'].includes(type)) {
      throw new Error(`Invalid record type: ${type}`);
    }
    if (typeof amount !== 'number' || amount < 0) {
      throw new Error('Amount must be a non-negative number');
    }

    if (reference_id) {
      const existing = await db
        .select()
        .from(records)
        .where(and(eq(records.business_id, business_id), eq(records.reference_id, reference_id)))
        .limit(1);

      if (existing.length > 0) {
        logger.warn('Duplicate record detected (idempotent request)', {
          business_id,
          reference_id,
          record_id: existing[0].id,
        });
        return existing[0];
      }
    }

    const client = trx || db;

    const runCreate = async clientInstance => {
      // Charge one token from the soonest-expiring lot, in this transaction.
      // The wallet row lock makes two simultaneous creates unable to both
      // spend the last token.
      try {
        await spendTokens(clientInstance, {
          businessId: business_id,
          amount: 1,
          type: 'charge',
          reference: reference_id ?? null,
          note: `Record created (${type})`,
          createdBy: user_id,
        });
      } catch (e) {
        if (e instanceof InsufficientTokensError) {
          throw new Error('Insufficient tokens. Please purchase tokens to create records.');
        }
        throw e;
      }

      const [newRecord] = await clientInstance
        .insert(records)
        .values({
          business_id,
          user_id,
          type,
          category,
          description,
          amount: String(amount),
          payment_method,
          product_id,
          transaction_date: new Date(transaction_date),
          mpesa_receipt_number: mpesa_data?.mpesaReceiptNumber || null,
          mpesa_sender_name: mpesa_data?.phoneNumber || null,
          mpesa_sender_phone: mpesa_data?.phoneNumber || null,
          mpesa_transaction_date: mpesa_data?.transactionDate ? new Date(mpesa_data.transactionDate) : null,
          mpesa_transaction_id: mpesa_data?.transactionId || null,
          credit_due_date: credit_due_date ? new Date(credit_due_date) : null,
          credit_status,
          token_deducted: 1,
          revenue_guard_reference: `RG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          reference_id,
          callback_processed: !!mpesa_data?.isProcessed,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      if (items && items.length > 0) {
        await clientInstance.insert(record_items).values(
          items.map(item => ({
            record_id: newRecord.id,
            item_name: item.item_name,
            description: item.description || null,
            quantity: item.quantity,
            unit_price: String(item.unit_price),
            total_amount: String(item.quantity * item.unit_price),
            product_id: item.product_id || null,
            cost_per_unit: item.cost_per_unit ? String(item.cost_per_unit) : null,
            created_at: new Date(),
          }))
        );
      }

      return newRecord;
    };

    let createdRecord;
    if (trx) {
      createdRecord = await runCreate(client);
    } else {
      createdRecord = await db.transaction(async tx => await runCreate(tx));
    }

    logger.info('Record created successfully', {
      record_id: createdRecord.id,
      type,
      business_id,
      amount,
    });

    return createdRecord;
  } catch (error) {
    logger.error('Record creation failed', { error: error.message, business_id, type });
    throw error;
  }
}

/**
 * GET RECORD BY ID — unchanged, no Google Sheets or money-calc involvement.
 */
export async function getRecordById(business_id, record_id) {
  try {
    const [record] = await db
      .select()
      .from(records)
      .where(and(eq(records.id, record_id), eq(records.business_id, business_id)));

    if (!record) {
      throw new Error('Record not found');
    }

    const items = await db
      .select({
        id: record_items.id,
        record_id: record_items.record_id,
        item_name: record_items.item_name,
        description: record_items.description,
        quantity: record_items.quantity,
        unit_price: record_items.unit_price,
        total_amount: record_items.total_amount,
        product_id: record_items.product_id,
        stock_batch_id: record_items.stock_batch_id,
        cost_per_unit: record_items.cost_per_unit,
        created_at: record_items.created_at,
      })
      .from(record_items)
      .innerJoin(records, eq(record_items.record_id, records.id))
      .where(
        and(
          eq(record_items.record_id, record.id),
          eq(records.business_id, business_id)
        )
      );

    return {
      ...record,
      items,
    };
  } catch (error) {
    logger.error('Failed to fetch record', {
      error: error.message,
      record_id,
      business_id,
    });
    throw error;
  }
}

/**
 * GET RECORDS: Fetch all records for business with filters — merges the
 * manual `records` mirror with an auto-derived view of `sales`.
 *
 * @param {number} business_id - Business ID
 * @param {Object} filters - Query filters
 * @param {string} [filters.type] - Record type (sales, hp, credit, etc.)
 * @param {string} [filters.payment_method] - Payment method (cash, mpesa)
 * @param {Date} [filters.start_date] - Start date range
 * @param {Date} [filters.end_date] - End date range
 * @param {number} [filters.limit] - Max records (default: 100)
 * @param {number} [filters.offset] - Pagination offset (default: 0)
 * @returns {Promise<Array>} Array of records
 */
export async function getRecords(
  business_id,
  { type = null, payment_method = null, start_date = null, end_date = null, limit = 100, offset = 0 } = {}
) {
  try {
    const mirrorRecords = await db.select().from(records).where(eq(records.business_id, business_id));

    const operationalSales = await db
      .select({
        id: sales.id,
        business_id: sales.business_id,
        user_id: sql`NULL`,
        type: sql`'sales'`,
        category: sql`'retail'`,
        description: sales.note,
        amount: sales.total_amount,
        quantity: sql`1`,
        payment_method: sales.payment_mode,
        mpesa_receipt_number: sales.mpesa_transaction_id,
        mpesa_sender_name: sales.mpesa_sender_name,
        mpesa_sender_phone: sales.mpesa_sender_phone,
        mpesa_transaction_date: sales.created_at,
        mpesa_transaction_id: sales.mpesa_transaction_id,
        product_id: sql`NULL`,
        stock_batch_id: sql`NULL`,
        cost_per_unit: sql`NULL`,
        credit_due_date: sql`NULL`,
        credit_amount_paid: sql`NULL`,
        credit_status: sql`NULL`,
        token_deducted: sql`0`,
        revenue_guard_reference: sql`NULL`,
        callback_processed: sql`false`,
        reference_id: sales.mpesa_transaction_id,
        notes: sales.note,
        transaction_date: sales.created_at,
        created_at: sales.created_at,
        updated_at: sales.updated_at,
      })
      .from(sales)
      // status='completed' only. Without it this merged every sale row
      // regardless of state, so an M-Pesa attempt that was never paid for —
      // still 'pending', or already 'failed' — showed up in /api/records as
      // if it were a real transaction. getStatementFinancials has always
      // filtered this way; this query was the one place that didn't, which
      // is why the records list and the statement could disagree.
      .where(and(eq(sales.business_id, business_id), eq(sales.status, 'completed')));

    const merged = mergeFinancialRecords(mirrorRecords, operationalSales);
    const filtered = applyRecordFilters(merged, { type, payment_method, start_date, end_date });

    return filtered
      .sort((a, b) => {
        const timeA = a.transaction_date ? a.transaction_date.getTime() : 0;
        const timeB = b.transaction_date ? b.transaction_date.getTime() : 0;
        return timeB - timeA;
      })
      .slice(offset, offset + limit);
  } catch (error) {
    logger.error('Failed to fetch records', {
      error: error.message,
      business_id,
      filters: { type, payment_method },
    });
    throw error;
  }
}

/**
 * GET RECORDS BY DATE RANGE — unchanged. Still used directly wherever the
 * raw manual ledger (not the full financial picture) is what's wanted.
 */
export async function getRecordsByDateRange(business_id, start_date, end_date = new Date()) {
  try {
    const result = await db
      .select()
      .from(records)
      .where(
        and(
          eq(records.business_id, business_id),
          gte(records.transaction_date, startOfBusinessDay(start_date)),
          lte(records.transaction_date, endOfBusinessDay(end_date))
        )
      )
      .orderBy(desc(records.transaction_date));

    return result;
  } catch (error) {
    logger.error('Failed to fetch records by date range', {
      error: error.message,
      business_id,
      start_date,
      end_date,
    });
    throw error;
  }
}

/**
 * CALCULATE TOTALS: real financial totals, sourced from actual sales,
 * credit repayments, and HP payments via getStatementFinancials() — not
 * the manual `records` mirror the old version read from.
 */
export async function calculateTotals(
  business_id,
  start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  end_date = new Date()
) {
  try {
    const { totals } = await getStatementFinancials(business_id, start_date, end_date);

    return {
      // Real money
      total_sales: parseFloat((totals.cash_sales + totals.mpesa_sales).toFixed(2)),
      cash_sales: totals.cash_sales,
      mpesa_sales: totals.mpesa_sales,
      cash_collected: totals.cash_collected,
      cash_in_hand: totals.cash_in_hand,

      // Debts opened this period — full value, NOT collected, NOT revenue
      credit_given: totals.credit_given_period,
      higher_purchase_given: totals.hp_given_period,

      // Real money collected against past debts this period
      credit_recovered: totals.credit_repaid_period,
      hp_collected: parseFloat((totals.hp_deposits_period + totals.hp_installments_period).toFixed(2)),

      // Costs
      total_cogs: totals.total_cogs,
      expenses: parseFloat((totals.petty_expenses + totals.operating_expenses).toFixed(2)),
      spoiled_stock_loss: totals.spoiled_total,

      // Bottom line — cost-recovery-first, matches the statement exactly
      realized_profit: totals.realized_profit,
      net_profit: totals.net_profit_for_period,

      // Outstanding, all-time
      credit_outstanding: totals.credit_outstanding,
      hp_outstanding: totals.hp_outstanding,
      total_receivables: totals.total_receivables,

      record_count:
        totals.cash_count + totals.mpesa_count + totals.credit_sales_opened_count + totals.hp_agreements_opened_count,
    };
  } catch (error) {
    logger.error('Failed to calculate totals', { error: error.message, business_id });
    throw error;
  }
}

/**
 * PROCESS M-PESA CALLBACK: Mark record as processed (idempotency) —
 * unchanged. Belongs to the manual ledger's own M-Pesa flow, separate
 * from sales.service.js's operational M-Pesa callback handling.
 */
export async function processM2PesaCallback(business_id, mpesa_transaction_id) {
  try {
    const [record] = await db
      .select()
      .from(records)
      .where(and(eq(records.business_id, business_id), eq(records.mpesa_transaction_id, mpesa_transaction_id)))
      .limit(1);

    if (!record) {
      throw new Error('Record not found for M-Pesa transaction');
    }

    if (record.callback_processed) {
      logger.info('M-Pesa callback already processed (idempotent)', {
        record_id: record.id,
        mpesa_transaction_id,
      });
      return record;
    }

    const [updated] = await db
      .update(records)
      .set({
        callback_processed: true,
        updated_at: new Date(),
      })
      .where(and(eq(records.id, record.id), eq(records.business_id, business_id)))
      .returning();

    logger.info('M-Pesa callback processed', {
      record_id: record.id,
      mpesa_transaction_id,
    });

    return updated;
  } catch (error) {
    logger.error('Failed to process M-Pesa callback', {
      error: error.message,
      business_id,
      mpesa_transaction_id,
    });
    throw error;
  }
}

/**
 * DASHBOARD INSIGHTS: real daily/weekly/monthly trend, sourced from
 * getDailyTrend / getMonthlyTrend (analytics.service.js).
 */
export async function getDashboardInsights(business_id, period = 'daily') {
  try {
    if (period === 'monthly') {
      const trend = await getMonthlyTrend(business_id, 12);
      return trend.map(m => ({
        period_key: m.month,
        cash_collected: m.cash_collected,
        net_profit: m.net_profit,
        transaction_count: m.transaction_count,
      }));
    }

    const daily = await getDailyTrend(business_id, 30);

    if (period === 'daily') {
      return daily.map(d => ({
        period_key: d.date,
        cash: d.cash_collected, // kept as `cash` for backward compatibility
        net_profit: d.net_profit,
        total: d.cash_collected,
        transaction_count: d.transaction_count,
      }));
    }

    // weekly
    const weeks = {};
    daily.forEach(d => {
      const date = new Date(d.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const key = weekStart.toISOString().split('T')[0];

      weeks[key] ??= { period_key: key, cash: 0, net_profit: 0, total: 0, transaction_count: 0 };
      weeks[key].cash += d.cash_collected;
      weeks[key].net_profit += d.net_profit;
      weeks[key].total += d.cash_collected;
      weeks[key].transaction_count += d.transaction_count;
    });

    return Object.values(weeks)
      .map(w => ({
        ...w,
        cash: parseFloat(w.cash.toFixed(2)),
        net_profit: parseFloat(w.net_profit.toFixed(2)),
        total: parseFloat(w.total.toFixed(2)),
      }))
      .sort((a, b) => new Date(a.period_key) - new Date(b.period_key));
  } catch (error) {
    logger.error('Failed to get dashboard insights', { error: error.message, business_id });
    throw error;
  }
}

export default {
  createRecord,
  getRecordById,
  getRecords,
  getRecordsByDateRange,
  calculateTotals,
  processM2PesaCallback,
  getDashboardInsights,
};