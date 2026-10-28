/**
 * =============================================================================
 * SERVICE: ANALYTICS
 * =============================================================================
 * All revenue/profit/cash figures in this file are now sourced from
 * getStatementFinancials() (sales.service.js) — the same engine that
 * powers the downloadable statement. That's deliberate: this dashboard
 * and that statement must never be able to disagree with each other again.
 *
 * getRevenueBreakdown() and getCOGS() have been removed — they were two
 * of the four separate, disagreeing profit calculators found in this
 * codebase (the others were in sales.service.js's old statement logic
 * and record.service.js's calculateTotals). Nothing computes its own
 * revenue/profit numbers in this file anymore; everything either reads
 * from getStatementFinancials() or reports a genuinely separate metric
 * (expenses by category, spoilage, top products, inventory, customers,
 * wallet) that was never part of the money-accuracy problem.
 * =============================================================================
 */

import { db } from '#config/database.js';
import { sql } from 'drizzle-orm';
import logger from '#config/logger.js';
import { sales, saleItems } from '#models/sales.model.js';
import { products } from '#models/stock.model.js';
import { expenses } from '#models/expense.model.js';
import { spoiledStock } from '#models/spoiledStock.model.js';
import { creditAccounts, creditPayments } from '#models/credit.model.js';
import {
  hirePurchaseAgreements,
  hirePurchaseInstallmentPayments,
} from '#models/higherPurchase.model.js';
import { wallets, walletTransactions, tokenPurchases } from '#models/myWallet.model.js';
import { eq, and, gte, lte, desc, sum, count } from 'drizzle-orm';
import { getStatementFinancials } from '#services/sales.service.js';
import { calculateItemProfit } from '#services/financialCalculations.js';
import { businessDayRange, NAIROBI_TZ } from '#utils/businessDay.js';

const SERVICE_NAME = 'Analytics Service';

// ─────────────────────────────────────────────
// DATE UTILITIES — all Nairobi timezone aware
// ─────────────────────────────────────────────

// NAIROBI_TZ now comes from utils/businessDay.js — one definition of the
// business timezone for the whole app.

/**
 * Get start/end of a period in Nairobi time, returned as Date objects.
 *
 * IMPORTANT: these must stay as Date objects, not ISO strings.
 * Drizzle's default `timestamp()` column mode expects a JS Date and calls
 * `.toISOString()` on it internally (see PgTimestamp.mapToDriverValue).
 * Passing a string here breaks with "value.toISOString is not a function"
 * because a string doesn't have that method.
 */
export function getDateRange(period, referenceDate = new Date()) {
  const ref = new Date(
    new Date(referenceDate).toLocaleString('en-US', { timeZone: NAIROBI_TZ })
  );

  let startLocal, endLocal;

  switch (period) {
    case 'daily':
      startLocal = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
      endLocal = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
      break;

    case 'weekly': {
      const day = ref.getDay(); // 0=Sun
      startLocal = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - day, 0, 0, 0, 0);
      endLocal = new Date(startLocal);
      endLocal.setDate(startLocal.getDate() + 6);
      endLocal.setHours(23, 59, 59, 999);
      break;
    }

    case 'monthly':
      startLocal = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
      endLocal = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
      break;

    case 'yearly':
      startLocal = new Date(ref.getFullYear(), 0, 1, 0, 0, 0, 0);
      endLocal = new Date(ref.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;

    default:
      throw new Error(`Invalid period: ${period}`);
  }

  // Convert Nairobi local time back to UTC for DB queries
  // Nairobi is UTC+3, so subtract 3 hours
  const toUTC = d => new Date(d.getTime() - 3 * 60 * 60 * 1000);

  return {
    startDate: toUTC(startLocal),
    endDate: toUTC(endLocal),
    // Human readable labels (Nairobi time)
    label: {
      start: startLocal.toLocaleDateString('en-KE'),
      end: endLocal.toLocaleDateString('en-KE'),
    },
  };
}

// ─────────────────────────────────────────────
// EXPENSES — by category, independent of the
// petty/operating split used inside the P&L.
// This view answers "where is money going",
// not "does it hit today's till" — different
// question, kept as its own stat.
// ─────────────────────────────────────────────

export async function getExpenseStats(businessId, startDate, endDate) {
  try {
    const results = await db
      .select({
        category: expenses.category,
        total: sum(expenses.amount),
        count: count(expenses.id),
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.business_id, businessId),
          gte(expenses.created_at, startDate),
          lte(expenses.created_at, endDate)
        )
      )
      .groupBy(expenses.category);

    const totalExpenses = results.reduce((s, r) => s + parseFloat(r.total || 0), 0);

    return {
      total_expenses: totalExpenses,
      by_category: results.map(r => ({
        category: r.category,
        amount: parseFloat(r.total || 0),
        count: r.count,
        percent_of_total:
          totalExpenses > 0
            ? parseFloat(((parseFloat(r.total || 0) / totalExpenses) * 100).toFixed(1))
            : 0,
      })),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getExpenseStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// SPOILAGE LOSSES
// ─────────────────────────────────────────────

export async function getSpoilageStats(businessId, startDate, endDate) {
  try {
    const [result] = await db
      .select({
        total_loss: sum(spoiledStock.total_loss_value),
        count: count(spoiledStock.id),
      })
      .from(spoiledStock)
      .where(
        and(
          eq(spoiledStock.business_id, businessId),
          gte(spoiledStock.created_at, startDate),
          lte(spoiledStock.created_at, endDate)
        )
      );

    return {
      total_spoilage_loss: parseFloat(result?.total_loss || 0),
      spoilage_count: result?.count || 0,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getSpoilageStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// CREDIT — dedicated view for a Credit screen.
// total_outstanding here is the live, all-time
// balance; period figures are informational
// (given vs repaid) — the actual money-safe
// figures (cash_in_hand, net_profit) come from
// getStatementFinancials, not from here.
// ─────────────────────────────────────────────

export async function getCreditStats(businessId, startDate, endDate) {
  try {
    // New credit accounts opened in period (informational — a credit
    // LIMIT being set isn't the same as credit actually given; for the
    // real "credit given this period" figure, see
    // getStatementFinancials().totals.credit_given_period)
    const [given] = await db
      .select({ total: sum(creditAccounts.credit_limit) })
      .from(creditAccounts)
      .where(
        and(
          eq(creditAccounts.business_id, businessId),
          gte(creditAccounts.created_at, startDate),
          lte(creditAccounts.created_at, endDate)
        )
      );

    // Repayments received in period — real cash
    const [received] = await db
      .select({ total: sum(creditPayments.amount) })
      .from(creditPayments)
      .innerJoin(creditAccounts, eq(creditPayments.account_id, creditAccounts.id))
      .where(
        and(
          eq(creditAccounts.business_id, businessId),
          gte(creditPayments.created_at, startDate),
          lte(creditPayments.created_at, endDate)
        )
      );

    // Total outstanding (all time)
    const [outstanding] = await db
      .select({ total: sum(creditAccounts.balance_due) })
      .from(creditAccounts)
      .where(eq(creditAccounts.business_id, businessId));

    return {
      credit_given_period: parseFloat(given?.total || 0),
      credit_repaid_period: parseFloat(received?.total || 0),
      total_outstanding: parseFloat(outstanding?.total || 0),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getCreditStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// HIRE PURCHASE — dedicated view for an HP
// screen. hp_collected_period now reads from
// the append-only hirePurchaseInstallments
// history correctly (deposit + installments),
// same source getStatementFinancials uses.
// ─────────────────────────────────────────────

export async function getHPStats(businessId, startDate, endDate) {
  try {
    // New HP agreements opened in period
    const [agreements] = await db
      .select({
        total_principal: sum(hirePurchaseAgreements.principal_amount),
        count: count(hirePurchaseAgreements.id),
      })
      .from(hirePurchaseAgreements)
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          gte(hirePurchaseAgreements.agreement_date, startDate),
          lte(hirePurchaseAgreements.agreement_date, endDate)
        )
      );

    // Deposits + installments actually received in period — real cash
    const [collected] = await db
      .select({ total: sum(hirePurchaseInstallmentPayments.amount) })
      .from(hirePurchaseInstallmentPayments)
      .innerJoin(
        hirePurchaseAgreements,
        eq(hirePurchaseInstallmentPayments.agreement_id, hirePurchaseAgreements.id)
      )
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          gte(hirePurchaseInstallmentPayments.payment_date, startDate),
          lte(hirePurchaseInstallmentPayments.payment_date, endDate)
        )
      );

    // Total HP outstanding (all time)
    const [outstanding] = await db
      .select({ total: sum(hirePurchaseAgreements.balance_remaining) })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    return {
      hp_agreements_period: agreements?.count || 0,
      hp_principal_period: parseFloat(agreements?.total_principal || 0),
      hp_collected_period: parseFloat(collected?.total || 0),
      hp_outstanding_total: parseFloat(outstanding?.total || 0),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getHPStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// FULL P&L STATEMENT — a view over
// getStatementFinancials(). This is the single
// biggest correction in this file: dashboard
// and statement now share one source of truth.
// ─────────────────────────────────────────────

export async function getProfitAndLoss(businessId, startDate, endDate) {
  try {
    const { totals } = await getStatementFinancials(businessId, startDate, endDate);

    const grossMarginPercent =
      totals.accrual_goods_sold_value > 0
        ? parseFloat(
          (((totals.accrual_goods_sold_value - totals.total_cogs) / totals.accrual_goods_sold_value) * 100).toFixed(1)
        )
        : 0;

    const netMarginPercent =
      totals.cash_collected > 0
        ? parseFloat(((totals.net_profit_for_period / totals.cash_collected) * 100).toFixed(1))
        : 0;

    const transactionCount =
      totals.cash_count + totals.mpesa_count + totals.credit_sales_opened_count + totals.hp_agreements_opened_count;

    return {
      // Business volume — total value of everything sold/agreed this
      // period, whether collected or not. NOT profit, NOT cash.
      accrual_goods_sold_value: totals.accrual_goods_sold_value,
      revenue_breakdown: {
        cash: totals.cash_sales,
        mpesa: totals.mpesa_sales,
        credit_given: totals.credit_given_period,  // opened this period, not yet collected
        hire_purchase: totals.hp_given_period,       // opened this period, not yet collected
      },

      // Cost / accrual profit — includes cash, mpesa, and credit COGS
      // (all FIFO-deducted at sale time). HP is correctly excluded:
      // no real cost exists until the agreement is fully paid off.
      total_cogs: totals.total_cogs,
      credit_cogs: totals.credit_cogs,
      gross_margin_percent: grossMarginPercent,

      // Operating deductions
      total_expenses: parseFloat((totals.petty_expenses + totals.operating_expenses).toFixed(2)),
      petty_expenses: totals.petty_expenses,
      operating_expenses: totals.operating_expenses,
      spoilage_loss: totals.spoiled_total,

      // Bottom line — real, cost-recovery-first, matches the
      // downloadable statement exactly
      realized_profit: totals.realized_profit,
      net_profit: totals.net_profit_for_period,
      net_margin_percent: netMarginPercent,

      // Real cash position — includes credit repayments & HP
      // deposits/installments collected this period, minus petty spend
      cash_in_hand: totals.cash_in_hand,
      cash_collected: totals.cash_collected,

      // Receivables — money owed TO the business, all-time balance
      receivables: {
        credit_outstanding: totals.credit_outstanding,
        hp_outstanding: totals.hp_outstanding,
        total_receivables: totals.total_receivables,
        credit_repaid_period: totals.credit_repaid_period,
        hp_collected_period: parseFloat((totals.hp_deposits_period + totals.hp_installments_period).toFixed(2)),
      },

      transaction_count: transactionCount,
      avg_transaction:
        transactionCount > 0
          ? parseFloat(
            (
              (totals.cash_sales + totals.mpesa_sales + totals.credit_given_period + totals.hp_given_period) /
              transactionCount
            ).toFixed(2)
          )
          : 0,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getProfitAndLoss`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// TRENDS — each point is its own real
// getStatementFinancials() call, so a trend
// line can never show a number the statement
// itself wouldn't produce for that same range.
// "Monthly profit starts with day one" is now
// literally true in code.
// ─────────────────────────────────────────────

export async function getDailyTrend(businessId, daysBack = 30) {
  try {
    const days = [];
    const today = new Date();
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d);
    }

    const points = await Promise.all(
      days.map(async d => {
        // Midnight to midnight, Africa/Nairobi — matches how the
        // Flutter frontend resets a "day" for the daily sales view.
        // Shared with the daily ledger and both statement paths via
        // utils/businessDay.js, so "a day" means one thing everywhere.
        const { dayKey, dayStart, dayEnd } = businessDayRange(d);

        const { totals } = await getStatementFinancials(businessId, dayStart, dayEnd);

        return {
          date: dayKey,
          cash_collected: totals.cash_collected,
          cash_in_hand: totals.cash_in_hand,
          realized_profit: totals.realized_profit,
          net_profit: totals.net_profit_for_period,
          // Same definition the dashboard summary uses: petty + operating.
          // Broken out too, since only petty hits the daily till while
          // operating is a month-end figure.
          petty_expenses: totals.petty_expenses,
          operating_expenses: totals.operating_expenses,
          total_expenses: parseFloat(
            (totals.petty_expenses + totals.operating_expenses).toFixed(2)
          ),
          accrual_goods_sold_value: totals.accrual_goods_sold_value,
          credit_given: totals.credit_given_period,
          hp_given: totals.hp_given_period,
          transaction_count:
            totals.cash_count + totals.mpesa_count + totals.credit_sales_opened_count + totals.hp_agreements_opened_count,
        };
      })
    );

    return points;
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getDailyTrend`, error);
    throw error;
  }
}

export async function getMonthlyTrend(businessId, monthsBack = 12) {
  try {
    const months = [];
    const today = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push(d);
    }

    const points = await Promise.all(
      months.map(async monthStart => {
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
        monthEnd.setMilliseconds(-1);

        const { totals } = await getStatementFinancials(businessId, monthStart, monthEnd);

        return {
          month: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
          cash_collected: totals.cash_collected,
          realized_profit: totals.realized_profit,
          net_profit: totals.net_profit_for_period,
          // The trend previously exposed no expense figure at all, so the
          // Flutter chart's "expenses" bar had nothing real to read and
          // rendered flat at zero for every month. Same definition as the
          // dashboard summary: petty + operating.
          petty_expenses: totals.petty_expenses,
          operating_expenses: totals.operating_expenses,
          total_expenses: parseFloat(
            (totals.petty_expenses + totals.operating_expenses).toFixed(2)
          ),
          net_margin_percent:
            totals.cash_collected > 0
              ? parseFloat(((totals.net_profit_for_period / totals.cash_collected) * 100).toFixed(1))
              : 0,
          accrual_goods_sold_value: totals.accrual_goods_sold_value,
          credit_given: totals.credit_given_period,
          hp_given: totals.hp_given_period,
          transaction_count:
            totals.cash_count + totals.mpesa_count + totals.credit_sales_opened_count + totals.hp_agreements_opened_count,
        };
      })
    );

    return points;
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getMonthlyTrend`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// TOP PRODUCTS — unaffected by the money-timing
// fixes. Cash/mpesa/credit items carry real
// FIFO cost/profit immediately. HP items sit at
// 0 profit until fully paid off — correct, since
// the goods haven't really left yet.
// ─────────────────────────────────────────────

export async function getTopProducts(businessId, startDate, endDate, limit = 10, sortBy = 'revenue') {
  try {
    const orderExpr = sortBy === 'profit' ? desc(sum(saleItems.profit)) : desc(sum(saleItems.total_price));

    const results = await db
      .select({
        product_id: saleItems.product_id,
        product_name: saleItems.product_name,
        total_revenue: sum(saleItems.total_price),
        total_cogs: sum(
          sql`CAST(${saleItems.unit_cost} AS NUMERIC) * CAST(${saleItems.quantity} AS NUMERIC)`
        ),
        total_profit: sum(saleItems.profit),
        units_sold: sum(saleItems.quantity),
        tx_count: count(saleItems.id),
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.sale_id, sales.id))
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      )
      .groupBy(saleItems.product_id, saleItems.product_name)
      .orderBy(orderExpr)
      .limit(limit);

    return results.map(r => {
      const revenue = parseFloat(r.total_revenue || 0);
      const profit = parseFloat(r.total_profit || 0);
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        total_revenue: revenue,
        total_cogs: parseFloat(r.total_cogs || 0),
        total_profit: profit,
        profit_margin_percent: revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(1)) : 0,
        units_sold: parseFloat(r.units_sold || 0),
        transaction_count: r.tx_count || 0,
      };
    });
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getTopProducts`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// INVENTORY VALUE — catalog-based "potential
// profit" projection (nothing here is sold yet).
// The per-item revenue/cost/profit arithmetic now
// routes through calculateItemProfit (Function 1)
// instead of a second inline copy of it. Also
// surfaces reserved_quantity (HP holds) so the
// Stock screen can show what's actually sellable.
// ─────────────────────────────────────────────

export async function getInventoryValue(businessId) {
  try {
    const items = await db
      .select({
        id: products.id,
        name: products.name,
        qty: products.current_quantity,
        reserved: products.reserved_quantity,
        buying_price: products.buying_price_per_unit,
        selling_price: products.selling_price_per_unit,
      })
      .from(products)
      .where(and(eq(products.business_id, businessId), eq(products.is_active, 1)));

    const mapped = items.map(p => {
      const qty = parseFloat(p.qty || 0);
      const reserved = parseFloat(p.reserved || 0);
      const sellableQty = qty - reserved;
      const buyingPrice = parseFloat(p.buying_price || 0);
      const sellingPrice = parseFloat(p.selling_price || 0);

      // Catalog-basis projection — Function 1 exactly. Still "potential"
      // profit (nothing sold yet), but the revenue/cost/profit arithmetic
      // is the central one rather than a second copy of it here.
      const { revenue: sellingValue, cost: costValue, profit } = calculateItemProfit({
        sellingPricePerUnit: sellingPrice,
        buyingPricePerUnit: buyingPrice,
        quantity: qty,
      });

      return {
        product_id: p.id,
        product_name: p.name,
        quantity: qty,
        reserved_quantity: reserved, // held for open HP agreements — not sellable
        sellable_quantity: sellableQty,
        buying_price: buyingPrice,
        selling_price: sellingPrice,
        cost_value: costValue,
        selling_value: sellingValue,
        potential_profit: profit,
        profit_margin_percent:
          buyingPrice > 0 ? parseFloat((((sellingPrice - buyingPrice) / buyingPrice) * 100).toFixed(1)) : 0,
      };
    });

    return {
      total_products: mapped.length,
      total_units: parseFloat(mapped.reduce((s, p) => s + p.quantity, 0).toFixed(2)),
      total_reserved_units: parseFloat(mapped.reduce((s, p) => s + p.reserved_quantity, 0).toFixed(2)),
      total_cost_value: parseFloat(mapped.reduce((s, p) => s + p.cost_value, 0).toFixed(2)),
      total_selling_value: parseFloat(mapped.reduce((s, p) => s + p.selling_value, 0).toFixed(2)),
      potential_profit: parseFloat(mapped.reduce((s, p) => s + p.potential_profit, 0).toFixed(2)),
      items: mapped,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getInventoryValue`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// CUSTOMER STATS — unchanged.
// ─────────────────────────────────────────────

export async function getCustomerStats(businessId, startDate, endDate) {
  try {
    const allSales = await db
      .select({
        customer_name: sales.customer_name,
        count: count(sales.id),
        total_spend: sum(sales.total_amount),
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      )
      .groupBy(sales.customer_name);

    const totalTransactions = allSales.reduce((s, r) => s + (r.count || 0), 0);
    const uniqueCustomers = allSales.length;
    const repeatCustomers = allSales.filter(r => r.count > 1).length;
    const topCustomers = [...allSales]
      .sort((a, b) => parseFloat(b.total_spend || 0) - parseFloat(a.total_spend || 0))
      .slice(0, 5)
      .map(r => ({
        customer_name: r.customer_name || 'Walk-in',
        transaction_count: r.count,
        total_spend: parseFloat(r.total_spend || 0),
      }));

    return {
      total_transactions: totalTransactions,
      unique_customers: uniqueCustomers,
      repeat_customers: repeatCustomers,
      repeat_rate_percent:
        uniqueCustomers > 0 ? parseFloat(((repeatCustomers / uniqueCustomers) * 100).toFixed(1)) : 0,
      top_customers: topCustomers,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getCustomerStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// WALLET / TOKEN STATS — unchanged, unrelated
// to sales money.
// ─────────────────────────────────────────────

export async function getWalletStats(businessId) {
  try {
    const [wallet] = await db
      .select({ balance: wallets.balance_tokens })
      .from(wallets)
      .where(eq(wallets.business_id, businessId))
      .limit(1);

    const [purchased] = await db
      .select({ total: sum(tokenPurchases.tokens_purchased) })
      .from(tokenPurchases)
      .where(and(eq(tokenPurchases.business_id, businessId), eq(tokenPurchases.status, 'success')));

    const [spent] = await db
      .select({
        total: sql`COALESCE(SUM(CASE WHEN ${walletTransactions.change_tokens} < 0 THEN -${walletTransactions.change_tokens} ELSE 0 END), 0)`,
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId));

    const [txCount] = await db
      .select({ count: count(walletTransactions.id) })
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId));

    return {
      current_balance: wallet?.balance || 0,
      total_tokens_purchased: Number(purchased?.total || 0),
      total_tokens_spent: Number(spent?.total || 0),
      transaction_count: txCount?.count || 0,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getWalletStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// DASHBOARD — full picture in one call
// ─────────────────────────────────────────────

export async function getDashboardData(businessId, period = 'daily') {
  try {
    const { startDate, endDate, label } = getDateRange(period);

    const [pnl, topProducts, inventory, customerStats, trend] = await Promise.all([
      getProfitAndLoss(businessId, startDate, endDate),
      getTopProducts(businessId, startDate, endDate, 5),
      getInventoryValue(businessId),
      getCustomerStats(businessId, startDate, endDate),
      period === 'yearly'
        ? getMonthlyTrend(businessId, 12)
        : getDailyTrend(businessId, period === 'monthly' ? 30 : 7),
    ]);

    return {
      period,
      date_range: { start: label.start, end: label.end },

      // The key numbers — real money, cost-recovery-first, matches the
      // downloadable statement exactly
      summary: {
        accrual_goods_sold_value: pnl.accrual_goods_sold_value,
        total_cogs: pnl.total_cogs,
        gross_margin_percent: pnl.gross_margin_percent,
        total_expenses: pnl.total_expenses,
        spoilage_loss: pnl.spoilage_loss,
        realized_profit: pnl.realized_profit,
        net_profit: pnl.net_profit,
        net_margin_percent: pnl.net_margin_percent,
        cash_in_hand: pnl.cash_in_hand,
        cash_collected: pnl.cash_collected,
        transaction_count: pnl.transaction_count,
        avg_transaction: pnl.avg_transaction,
      },

      // Revenue split — credit/HP shown as "given", not collected
      revenue_breakdown: pnl.revenue_breakdown,

      // Money owed TO the business
      receivables: pnl.receivables,

      // Best sellers
      top_products: topProducts,

      // Stock value — now shows reserved (HP-held) vs sellable
      inventory,

      // Customer behaviour
      customers: customerStats,

      // Chart data — each point is a real getStatementFinancials() call
      trend,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getDashboardData`, error);
    throw error;
  }
}

export default {
  getDateRange,
  getExpenseStats,
  getSpoilageStats,
  getCreditStats,
  getHPStats,
  getProfitAndLoss,
  getDailyTrend,
  getMonthlyTrend,
  getTopProducts,
  getInventoryValue,
  getCustomerStats,
  getWalletStats,
  getDashboardData,
};