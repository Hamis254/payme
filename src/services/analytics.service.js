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
  hirePurchasePayments,
} from '#models/higherPurchase.model.js';
import { eq, and, gte, lte, desc, sum, count } from 'drizzle-orm';

const SERVICE_NAME = 'Analytics Service';

// ─────────────────────────────────────────────
// DATE UTILITIES — all Nairobi timezone aware
// ─────────────────────────────────────────────

const NAIROBI_TZ = 'Africa/Nairobi';

/**
 * Get start/end of a period in Nairobi time, returned as UTC ISO strings
 * so Postgres comparisons are correct
 */
export function getDateRange(period, referenceDate = new Date()) {
  const ref = new Date(
    new Date(referenceDate).toLocaleString('en-US', { timeZone: NAIROBI_TZ })
  );

  let startLocal, endLocal;

  switch (period) {
    case 'daily':
      startLocal = new Date(
        ref.getFullYear(),
        ref.getMonth(),
        ref.getDate(),
        0,
        0,
        0,
        0
      );
      endLocal = new Date(
        ref.getFullYear(),
        ref.getMonth(),
        ref.getDate(),
        23,
        59,
        59,
        999
      );
      break;

    case 'weekly': {
      const day = ref.getDay(); // 0=Sun
      startLocal = new Date(
        ref.getFullYear(),
        ref.getMonth(),
        ref.getDate() - day,
        0,
        0,
        0,
        0
      );
      endLocal = new Date(startLocal);
      endLocal.setDate(startLocal.getDate() + 6);
      endLocal.setHours(23, 59, 59, 999);
      break;
    }

    case 'monthly':
      startLocal = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
      endLocal = new Date(
        ref.getFullYear(),
        ref.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );
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
    startDate: toUTC(startLocal).toISOString(),
    endDate: toUTC(endLocal).toISOString(),
    // Human readable labels (Nairobi time)
    label: {
      start: startLocal.toLocaleDateString('en-KE'),
      end: endLocal.toLocaleDateString('en-KE'),
    },
  };
}

// ─────────────────────────────────────────────
// REVENUE
// ─────────────────────────────────────────────

export async function getRevenueBreakdown(businessId, startDate, endDate) {
  try {
    const result = await db
      .select({
        payment_mode: sales.payment_mode,
        total: sum(sales.total_amount),
        tx_count: count(sales.id),
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
      .groupBy(sales.payment_mode);

    const breakdown = {
      cash: 0,
      mpesa: 0,
      credit: 0,
      hire_purchase: 0,
      cash_count: 0,
      mpesa_count: 0,
      credit_count: 0,
      hp_count: 0,
    };

    for (const row of result) {
      const mode = row.payment_mode;
      const total = parseFloat(row.total || 0);
      const count_ = row.tx_count || 0;

      if (mode === 'cash') {
        breakdown.cash = total;
        breakdown.cash_count = count_;
      }
      if (mode === 'mpesa') {
        breakdown.mpesa = total;
        breakdown.mpesa_count = count_;
      }
      if (mode === 'credit') {
        breakdown.credit = total;
        breakdown.credit_count = count_;
      }
      if (mode === 'hire_purchase') {
        breakdown.hire_purchase = total;
        breakdown.hp_count = count_;
      }
    }

    breakdown.gross_revenue =
      breakdown.cash +
      breakdown.mpesa +
      breakdown.credit +
      breakdown.hire_purchase;
    breakdown.total_transactions =
      breakdown.cash_count +
      breakdown.mpesa_count +
      breakdown.credit_count +
      breakdown.hp_count;
    breakdown.avg_transaction =
      breakdown.total_transactions > 0
        ? breakdown.gross_revenue / breakdown.total_transactions
        : 0;

    return breakdown;
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getRevenueBreakdown`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// COST OF GOODS SOLD (COGS) — from saleItems FIFO
// ─────────────────────────────────────────────

export async function getCOGS(businessId, startDate, endDate) {
  try {
    const [result] = await db
      .select({
        total_cogs: sum(
          sql`CAST(${saleItems.unit_cost} AS NUMERIC) * CAST(${saleItems.quantity} AS NUMERIC)`
        ),
        total_revenue: sum(saleItems.total_price),
        total_profit: sum(saleItems.profit),
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
      );

    return {
      total_cogs: parseFloat(result?.total_cogs || 0),
      total_revenue: parseFloat(result?.total_revenue || 0),
      gross_profit: parseFloat(result?.total_profit || 0),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getCOGS`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// EXPENSES
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

    const totalExpenses = results.reduce(
      (s, r) => s + parseFloat(r.total || 0),
      0
    );

    return {
      total_expenses: totalExpenses,
      by_category: results.map(r => ({
        category: r.category,
        amount: parseFloat(r.total || 0),
        count: r.count,
        percent_of_total:
          totalExpenses > 0
            ? parseFloat(
              ((parseFloat(r.total || 0) / totalExpenses) * 100).toFixed(1)
            )
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
// CREDIT — what's owed to the business
// ─────────────────────────────────────────────

export async function getCreditStats(businessId, startDate, endDate) {
  try {
    // New credit given in period
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

    // Repayments received in period
    const [received] = await db
      .select({ total: sum(creditPayments.amount) })
      .from(creditPayments)
      .innerJoin(
        creditAccounts,
        eq(creditPayments.credit_account_id, creditAccounts.id)
      )
      .where(
        and(
          eq(creditAccounts.business_id, businessId),
          gte(creditPayments.created_at, startDate),
          lte(creditPayments.created_at, endDate)
        )
      );

    // Total outstanding (all time)
    const [outstanding] = await db
      .select({ total: sum(creditAccounts.outstanding_balance) })
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
// HIRE PURCHASE
// ─────────────────────────────────────────────

export async function getHPStats(businessId, startDate, endDate) {
  try {
    // New HP agreements in period
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

    // Installments received in period
    const [installments] = await db
      .select({ total: sum(hirePurchasePayments.amount_paid) })
      .from(hirePurchasePayments)
      .innerJoin(
        hirePurchaseAgreements,
        eq(hirePurchasePayments.agreement_id, hirePurchaseAgreements.id)
      )
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          gte(hirePurchasePayments.payment_date, startDate),
          lte(hirePurchasePayments.payment_date, endDate)
        )
      );

    // Total HP outstanding (all time)
    const [outstanding] = await db
      .select({ total: sum(hirePurchaseAgreements.outstanding_balance) })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    return {
      hp_agreements_period: agreements?.count || 0,
      hp_principal_period: parseFloat(agreements?.total_principal || 0),
      hp_collected_period: parseFloat(installments?.total || 0),
      hp_outstanding_total: parseFloat(outstanding?.total || 0),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getHPStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// FULL P&L STATEMENT
// ─────────────────────────────────────────────

export async function getProfitAndLoss(businessId, startDate, endDate) {
  try {
    const [revenue, cogs, expenseStats, spoilage, credit, hp] =
      await Promise.all([
        getRevenueBreakdown(businessId, startDate, endDate),
        getCOGS(businessId, startDate, endDate),
        getExpenseStats(businessId, startDate, endDate),
        getSpoilageStats(businessId, startDate, endDate),
        getCreditStats(businessId, startDate, endDate),
        getHPStats(businessId, startDate, endDate),
      ]);

    const grossRevenue = revenue.gross_revenue;
    const grossProfit = cogs.gross_profit;
    const grossMarginPercent =
      grossRevenue > 0
        ? parseFloat(((grossProfit / grossRevenue) * 100).toFixed(1))
        : 0;

    const totalDeductions =
      expenseStats.total_expenses + spoilage.total_spoilage_loss;

    const netProfit = grossProfit - totalDeductions;
    const netMarginPercent =
      grossRevenue > 0
        ? parseFloat(((netProfit / grossRevenue) * 100).toFixed(1))
        : 0;

    // Cash position: only cash and M-Pesa are real money in hand
    const cashInHand =
      revenue.cash +
      revenue.mpesa -
      expenseStats.total_expenses -
      spoilage.total_spoilage_loss;

    return {
      // Revenue lines
      gross_revenue: parseFloat(grossRevenue.toFixed(2)),
      revenue_breakdown: {
        cash: revenue.cash,
        mpesa: revenue.mpesa,
        credit_given: revenue.credit,
        hire_purchase: revenue.hire_purchase,
      },

      // Cost lines
      total_cogs: parseFloat(cogs.total_cogs.toFixed(2)),
      gross_profit: parseFloat(grossProfit.toFixed(2)),
      gross_margin_percent: grossMarginPercent,

      // Operating deductions
      total_expenses: parseFloat(expenseStats.total_expenses.toFixed(2)),
      spoilage_loss: parseFloat(spoilage.total_spoilage_loss.toFixed(2)),
      total_deductions: parseFloat(totalDeductions.toFixed(2)),

      // Bottom line
      net_profit: parseFloat(netProfit.toFixed(2)),
      net_margin_percent: netMarginPercent,

      // Cash position
      cash_in_hand: parseFloat(cashInHand.toFixed(2)),

      // Receivables (money owed TO the business)
      receivables: {
        credit_outstanding: credit.total_outstanding,
        hp_outstanding: hp.hp_outstanding_total,
        total_receivables: credit.total_outstanding + hp.hp_outstanding_total,
        credit_repaid_period: credit.credit_repaid_period,
        hp_collected_period: hp.hp_collected_period,
      },

      // Transaction counts
      transaction_count: revenue.total_transactions,
      avg_transaction: parseFloat(revenue.avg_transaction.toFixed(2)),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getProfitAndLoss`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// TRENDS — daily for period (Nairobi-aware)
// ─────────────────────────────────────────────

export async function getDailyTrend(businessId, daysBack = 30) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - daysBack);

    // Revenue per day
    const revenueRows = await db
      .select({
        date: sql`DATE(${sales.created_at} AT TIME ZONE 'Africa/Nairobi')`.as(
          'date'
        ),
        revenue: sum(sales.total_amount),
        profit: sum(sales.total_profit),
        tx_count: count(sales.id),
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate.toISOString()),
          lte(sales.created_at, endDate.toISOString())
        )
      )
      .groupBy(sql`DATE(${sales.created_at} AT TIME ZONE 'Africa/Nairobi')`)
      .orderBy(sql`DATE(${sales.created_at} AT TIME ZONE 'Africa/Nairobi')`);

    // Expenses per day
    const expenseRows = await db
      .select({
        date: sql`DATE(${expenses.created_at} AT TIME ZONE 'Africa/Nairobi')`.as(
          'date'
        ),
        total: sum(expenses.amount),
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.business_id, businessId),
          gte(expenses.created_at, startDate.toISOString()),
          lte(expenses.created_at, endDate.toISOString())
        )
      )
      .groupBy(sql`DATE(${expenses.created_at} AT TIME ZONE 'Africa/Nairobi')`);

    // Merge by date
    const expenseMap = {};
    expenseRows.forEach(r => {
      expenseMap[r.date] = parseFloat(r.total || 0);
    });

    return revenueRows.map(r => {
      const dailyExpenses = expenseMap[r.date] || 0;
      const grossProfit = parseFloat(r.profit || 0);
      const netProfit = grossProfit - dailyExpenses;

      return {
        date: r.date,
        revenue: parseFloat(r.revenue || 0),
        gross_profit: grossProfit,
        expenses: dailyExpenses,
        net_profit: netProfit,
        transaction_count: r.tx_count || 0,
      };
    });
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getDailyTrend`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// MONTHLY TREND — 12 months rolling
// ─────────────────────────────────────────────

export async function getMonthlyTrend(businessId, monthsBack = 12) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - monthsBack);

    const revenueRows = await db
      .select({
        month:
          sql`TO_CHAR(${sales.created_at} AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM')`.as(
            'month'
          ),
        revenue: sum(sales.total_amount),
        profit: sum(sales.total_profit),
        tx_count: count(sales.id),
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate.toISOString()),
          lte(sales.created_at, endDate.toISOString())
        )
      )
      .groupBy(
        sql`TO_CHAR(${sales.created_at} AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM')`
      )
      .orderBy(
        sql`TO_CHAR(${sales.created_at} AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM')`
      );

    const expenseRows = await db
      .select({
        month:
          sql`TO_CHAR(${expenses.created_at} AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM')`.as(
            'month'
          ),
        total: sum(expenses.amount),
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.business_id, businessId),
          gte(expenses.created_at, startDate.toISOString()),
          lte(expenses.created_at, endDate.toISOString())
        )
      )
      .groupBy(
        sql`TO_CHAR(${expenses.created_at} AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM')`
      );

    const expenseMap = {};
    expenseRows.forEach(r => {
      expenseMap[r.month] = parseFloat(r.total || 0);
    });

    return revenueRows.map(r => {
      const monthlyExpenses = expenseMap[r.month] || 0;
      const grossProfit = parseFloat(r.profit || 0);
      const netProfit = grossProfit - monthlyExpenses;
      const revenue = parseFloat(r.revenue || 0);

      return {
        month: r.month,
        revenue,
        gross_profit: grossProfit,
        expenses: monthlyExpenses,
        net_profit: netProfit,
        net_margin_percent:
          revenue > 0
            ? parseFloat(((netProfit / revenue) * 100).toFixed(1))
            : 0,
        transaction_count: r.tx_count || 0,
      };
    });
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getMonthlyTrend`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// TOP PRODUCTS (by revenue AND by profit)
// ─────────────────────────────────────────────

export async function getTopProducts(
  businessId,
  startDate,
  endDate,
  limit = 10
) {
  try {
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
      .orderBy(desc(sum(saleItems.total_price)))
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
        profit_margin_percent:
          revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(1)) : 0,
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
// INVENTORY VALUE
// ─────────────────────────────────────────────

export async function getInventoryValue(businessId) {
  try {
    const items = await db
      .select({
        id: products.id,
        name: products.name,
        qty: products.current_quantity,
        buying_price: products.buying_price_per_unit,
        selling_price: products.selling_price_per_unit,
      })
      .from(products)
      .where(
        and(eq(products.business_id, businessId), eq(products.is_active, 1))
      );

    const mapped = items.map(p => {
      const qty = parseFloat(p.qty || 0);
      const buyingPrice = parseFloat(p.buying_price || 0);
      const sellingPrice = parseFloat(p.selling_price || 0);
      const costValue = qty * buyingPrice;
      const sellingValue = qty * sellingPrice;

      return {
        product_id: p.id,
        product_name: p.name,
        quantity: qty,
        buying_price: buyingPrice,
        selling_price: sellingPrice,
        cost_value: parseFloat(costValue.toFixed(2)),
        selling_value: parseFloat(sellingValue.toFixed(2)),
        potential_profit: parseFloat((sellingValue - costValue).toFixed(2)),
        profit_margin_percent:
          buyingPrice > 0
            ? parseFloat(
              (((sellingPrice - buyingPrice) / buyingPrice) * 100).toFixed(1)
            )
            : 0,
      };
    });

    return {
      total_products: mapped.length,
      total_units: parseFloat(
        mapped.reduce((s, p) => s + p.quantity, 0).toFixed(2)
      ),
      total_cost_value: parseFloat(
        mapped.reduce((s, p) => s + p.cost_value, 0).toFixed(2)
      ),
      total_selling_value: parseFloat(
        mapped.reduce((s, p) => s + p.selling_value, 0).toFixed(2)
      ),
      potential_profit: parseFloat(
        mapped.reduce((s, p) => s + p.potential_profit, 0).toFixed(2)
      ),
      items: mapped,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getInventoryValue`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// CUSTOMER STATS
// ─────────────────────────────────────────────

export async function getCustomerStats(businessId, startDate, endDate) {
  try {
    // Use subquery to get distinct customer names correctly
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
      .sort(
        (a, b) =>
          parseFloat(b.total_spend || 0) - parseFloat(a.total_spend || 0)
      )
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
        uniqueCustomers > 0
          ? parseFloat(((repeatCustomers / uniqueCustomers) * 100).toFixed(1))
          : 0,
      top_customers: topCustomers,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getCustomerStats`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// DASHBOARD — full picture in one call
// ─────────────────────────────────────────────

export async function getDashboardData(businessId, period = 'daily') {
  try {
    const { startDate, endDate, label } = getDateRange(period);

    const [pnl, topProducts, inventory, customerStats, dailyTrend] =
      await Promise.all([
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

      // The key numbers
      summary: {
        gross_revenue: pnl.gross_revenue,
        total_cogs: pnl.total_cogs,
        gross_profit: pnl.gross_profit,
        gross_margin_percent: pnl.gross_margin_percent,
        total_expenses: pnl.total_expenses,
        spoilage_loss: pnl.spoilage_loss,
        net_profit: pnl.net_profit,
        net_margin_percent: pnl.net_margin_percent,
        cash_in_hand: pnl.cash_in_hand,
        transaction_count: pnl.transaction_count,
        avg_transaction: pnl.avg_transaction,
      },

      // Revenue split
      revenue_breakdown: pnl.revenue_breakdown,

      // Money owed TO the business
      receivables: pnl.receivables,

      // Best sellers
      top_products: topProducts,

      // Stock value
      inventory,

      // Customer behaviour
      customers: customerStats,

      // Chart data
      trend: dailyTrend,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: getDashboardData`, error);
    throw error;
  }
}

export default {
  getDateRange,
  getRevenueBreakdown,
  getCOGS,
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
  getDashboardData,
};
