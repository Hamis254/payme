import { db, sql } from '#config/database.js';
import logger from '#config/logger.js';
import { analyticsCache } from '#models/analytics.model.js';
import { sales, saleItems } from '#models/sales.model.js';
import { products } from '#models/stock.model.js';
import { walletTransactions, tokenPurchases } from '#models/myWallet.model.js';
import { expenses } from '#models/expense.model.js';
import {
  eq,
  and,
  gte,
  lte,
  desc,
  sum,
  count,
  avg,
} from 'drizzle-orm';

const SERVICE_NAME = 'Analytics Service';

/**
 * Get date range for period (daily, weekly, monthly, yearly)
 * Returns: { startDate, endDate }
 */
export function getDateRange(period, referenceDate = new Date()) {
  const ref = new Date(referenceDate);
  let startDate, endDate;

  switch (period) {
    case 'daily':
      startDate = new Date(ref);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(ref);
      endDate.setHours(23, 59, 59, 999);
      break;

    case 'weekly': {
      const dayOfWeek = ref.getDay();
      startDate = new Date(ref);
      startDate.setDate(ref.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    case 'monthly':
      startDate = new Date(ref.getFullYear(), ref.getMonth(), 1);
      endDate = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
      break;

    case 'yearly':
      startDate = new Date(ref.getFullYear(), 0, 1);
      endDate = new Date(ref.getFullYear(), 11, 31);
      endDate.setHours(23, 59, 59, 999);
      break;

    default:
      throw new Error(`Invalid period: ${period}`);
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

/**
 * Calculate total sales for a business in a date range
 */
export async function getTotalSales(businessId, startDate, endDate) {
  try {
    const result = await db
      .select({
        total: sum(sales.total_amount),
        count: count(sales.id),
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      );

    return {
      totalRevenue: parseFloat(result[0]?.total || 0),
      transactionCount: result[0]?.count || 0,
      avgTransaction:
        (result[0]?.count || 0) > 0
          ? parseFloat(result[0]?.total || 0) / result[0]?.count
          : 0,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting total sales`, error);
    throw error;
  }
}

/**
 * Calculate total profit for a business
 */
export async function getTotalProfit(businessId, startDate, endDate) {
  try {
    const result = await db
      .select({
        total: sum(sales.total_profit),
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      );

    return parseFloat(result[0]?.total || 0);
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting total profit`, error);
    throw error;
  }
}

/**
 * Get profit margin (profit / revenue * 100)
 */
export async function getProfitMargin(businessId, startDate, endDate) {
  try {
    const revenue = await getTotalSales(businessId, startDate, endDate);
    const profit = await getTotalProfit(businessId, startDate, endDate);

    if (revenue.totalRevenue === 0) return 0;
    return (profit / revenue.totalRevenue) * 100;
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting profit margin`, error);
    throw error;
  }
}

/**
 * Get top products by revenue
 */
export async function getTopProductsByRevenue(businessId, startDate, endDate, limit = 10) {
  try {
    const results = await db
      .select({
        productId: saleItems.product_id,
        productName: products.name,
        totalRevenue: sum(saleItems.total_price),
        unitsSold: sum(saleItems.quantity),
        totalProfit: sum(saleItems.profit),
        avgUnitPrice: avg(saleItems.unit_price),
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.sale_id, sales.id))
      .innerJoin(products, eq(saleItems.product_id, products.id))
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      )
      .groupBy(saleItems.product_id, products.name)
      .orderBy(desc(sum(saleItems.total_price)))
      .limit(limit);

    return results.map(r => ({
      productId: r.productId,
      productName: r.productName,
      totalRevenue: parseFloat(r.totalRevenue || 0),
      unitsSold: parseFloat(r.unitsSold || 0),
      totalProfit: parseFloat(r.totalProfit || 0),
      avgUnitPrice: parseFloat(r.avgUnitPrice || 0),
    }));
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting top products by revenue`, error);
    throw error;
  }
}

/**
 * Get top products by profit
 */
export async function getTopProductsByProfit(businessId, startDate, endDate, limit = 10) {
  try {
    const results = await db
      .select({
        productId: saleItems.product_id,
        productName: products.name,
        totalRevenue: sum(saleItems.total_price),
        totalProfit: sum(saleItems.profit),
        unitsSold: sum(saleItems.quantity),
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.sale_id, sales.id))
      .innerJoin(products, eq(saleItems.product_id, products.id))
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      )
      .groupBy(saleItems.product_id, products.name)
      .orderBy(desc(sum(saleItems.profit)))
      .limit(limit);

    return results.map(r => ({
      productId: r.productId,
      productName: r.productName,
      totalRevenue: parseFloat(r.totalRevenue || 0),
      totalProfit: parseFloat(r.totalProfit || 0),
      unitsSold: parseFloat(r.unitsSold || 0),
    }));
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting top products by profit`, error);
    throw error;
  }
}

/**
 * Get revenue breakdown by payment method
 */
export async function getRevenueByPaymentMethod(businessId, startDate, endDate) {
  try {
    const results = await db
      .select({
        paymentMethod: sales.payment_mode,
        totalRevenue: sum(sales.total_amount),
        transactionCount: count(sales.id),
        avgTransaction: avg(sales.total_amount),
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

    return results.map(r => ({
      paymentMethod: r.paymentMethod,
      totalRevenue: parseFloat(r.totalRevenue || 0),
      transactionCount: r.transactionCount || 0,
      avgTransaction: parseFloat(r.avgTransaction || 0),
    }));
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting revenue by payment method`, error);
    throw error;
  }
}

/**
 * Get revenue breakdown by customer type
 */
export async function getRevenueByCustomerType(businessId, startDate, endDate) {
  try {
    const results = await db
      .select({
        customerType: sales.customer_type,
        totalRevenue: sum(sales.total_amount),
        transactionCount: count(sales.id),
        avgTransaction: avg(sales.total_amount),
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
      .groupBy(sales.customer_type);

    return results.map(r => ({
      customerType: r.customerType,
      totalRevenue: parseFloat(r.totalRevenue || 0),
      transactionCount: r.transactionCount || 0,
      avgTransaction: parseFloat(r.avgTransaction || 0),
    }));
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting revenue by customer type`, error);
    throw error;
  }
}

/**
 * Get daily sales trend (last 30 days)
 */
export async function getDailySalesTrend(businessId, daysBack = 30) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - daysBack);

    const results = await db
      .select({
        date: sql`DATE(${sales.created_at})`.as('date'),
        totalRevenue: sum(sales.total_amount),
        totalProfit: sum(sales.total_profit),
        transactionCount: count(sales.id),
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate.toISOString().split('T')[0]),
          lte(sales.created_at, endDate.toISOString().split('T')[0])
        )
      )
      .groupBy(sql`DATE(${sales.created_at})`)
      .orderBy(sql`DATE(${sales.created_at})`);

    return results.map(r => ({
      date: r.date,
      totalRevenue: parseFloat(r.totalRevenue || 0),
      totalProfit: parseFloat(r.totalProfit || 0),
      transactionCount: r.transactionCount || 0,
    }));
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting daily sales trend`, error);
    throw error;
  }
}

/**
 * Get inventory value summary
 */
export async function getInventoryValue(businessId) {
  try {
    const results = await db
      .select({
        productId: products.id,
        productName: products.name,
        currentQuantity: products.current_quantity,
        buyingPrice: products.buying_price_per_unit,
        sellingPrice: products.selling_price_per_unit,
      })
      .from(products)
      .where(and(eq(products.business_id, businessId), eq(products.is_active, 1)));

    const items = results.map(p => ({
      productId: p.productId,
      productName: p.productName,
      quantity: parseFloat(p.currentQuantity || 0),
      buyingPrice: parseFloat(p.buyingPrice || 0),
      sellingPrice: parseFloat(p.sellingPrice || 0),
      costValue: parseFloat(p.currentQuantity || 0) * parseFloat(p.buyingPrice || 0),
      sellingValue: parseFloat(p.currentQuantity || 0) * parseFloat(p.sellingPrice || 0),
    }));

    return {
      totalItems: items.length,
      totalQuantity: items.reduce((sum, p) => sum + p.quantity, 0),
      totalCostValue: items.reduce((sum, p) => sum + p.costValue, 0),
      totalSellingValue: items.reduce((sum, p) => sum + p.sellingValue, 0),
      potentialProfit: items.reduce((sum, p) => sum + (p.sellingValue - p.costValue), 0),
      items,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting inventory value`, error);
    throw error;
  }
}

/**
 * Get total token wallet statistics
 */
export async function getWalletStats(businessId) {
  try {
    const [walletData] = await db
      .select({
        totalTokensPurchased: sum(tokenPurchases.tokens_purchased),
        totalSpent: sum(tokenPurchases.amount_paid),
        purchaseCount: count(tokenPurchases.id),
      })
      .from(tokenPurchases)
      .where(eq(tokenPurchases.business_id, businessId));

    const [transactionData] = await db
      .select({
        totalTokensReserved: sum(sql`CASE WHEN ${walletTransactions.type} = 'reserve' THEN ${walletTransactions.change_tokens} ELSE 0 END`),
        totalTokensCharged: sum(sql`CASE WHEN ${walletTransactions.type} = 'charge' THEN ABS(${walletTransactions.change_tokens}) ELSE 0 END`),
        totalTokensRefunded: sum(sql`CASE WHEN ${walletTransactions.type} = 'refund' THEN ${walletTransactions.change_tokens} ELSE 0 END`),
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId));

    return {
      totalTokensPurchased: parseFloat(walletData?.totalTokensPurchased || 0),
      totalSpent: parseFloat(walletData?.totalSpent || 0),
      purchaseCount: walletData?.purchaseCount || 0,
      avgTokensPerPurchase:
        (walletData?.purchaseCount || 0) > 0
          ? parseFloat(walletData?.totalTokensPurchased || 0) / walletData?.purchaseCount
          : 0,
      tokensReserved: parseFloat(transactionData?.totalTokensReserved || 0),
      tokensCharged: parseFloat(transactionData?.totalTokensCharged || 0),
      tokensRefunded: parseFloat(transactionData?.totalTokensRefunded || 0),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting wallet stats`, error);
    throw error;
  }
}

/**
 * Get expense summary
 */
export async function getExpenseStats(businessId, startDate, endDate) {
  try {
    const results = await db
      .select({
        category: expenses.category,
        totalAmount: sum(expenses.amount),
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

    const totalExpenses = results.reduce((sum, r) => sum + parseFloat(r.totalAmount || 0), 0);

    return {
      totalExpenses,
      byCategory: results.map(r => ({
        category: r.category,
        amount: parseFloat(r.totalAmount || 0),
        count: r.count,
        percentOfTotal: totalExpenses > 0 ? (parseFloat(r.totalAmount || 0) / totalExpenses) * 100 : 0,
      })),
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting expense stats`, error);
    throw error;
  }
}

/**
 * Get customer statistics (repeat customers, etc)
 */
export async function getCustomerStats(businessId, startDate, endDate) {
  try {
    const totalSales = await db
      .select({
        count: count(sales.id),
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.status, 'completed'),
          gte(sales.created_at, startDate),
          lte(sales.created_at, endDate)
        )
      );

    const uniqueCustomers = await db
      .select({
        count: count(sales.customer_name),
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
      .distinct();

    const repeatCustomers = await db
      .select({
        customerName: sales.customer_name,
        purchaseCount: count(sales.id),
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
      .groupBy(sales.customer_name)
      .having(sql`COUNT(*) > 1`);

    return {
      totalTransactions: totalSales[0]?.count || 0,
      uniqueCustomers: uniqueCustomers.length,
      repeatCustomerCount: repeatCustomers.length,
      repeatCustomerPercent:
        (uniqueCustomers.length || 0) > 0
          ? (repeatCustomers.length / uniqueCustomers.length) * 100
          : 0,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting customer stats`, error);
    throw error;
  }
}

/**
 * Get comprehensive dashboard data
 */
export async function getDashboardData(businessId, period = 'daily') {
  try {
    const { startDate, endDate } = getDateRange(period);

    const [salesData, profit, margin, topRevenueProducts, topProfitProducts, paymentBreakdown, customerTypeBreakdown, inventoryValue, walletStats, expenseStats, customerStats] = await Promise.all([
      getTotalSales(businessId, startDate, endDate),
      getTotalProfit(businessId, startDate, endDate),
      getProfitMargin(businessId, startDate, endDate),
      getTopProductsByRevenue(businessId, startDate, endDate, 5),
      getTopProductsByProfit(businessId, startDate, endDate, 5),
      getRevenueByPaymentMethod(businessId, startDate, endDate),
      getRevenueByCustomerType(businessId, startDate, endDate),
      getInventoryValue(businessId),
      getWalletStats(businessId),
      getExpenseStats(businessId, startDate, endDate),
      getCustomerStats(businessId, startDate, endDate),
    ]);

    return {
      period,
      dateRange: { startDate, endDate },
      summary: {
        totalRevenue: salesData.totalRevenue,
        transactionCount: salesData.transactionCount,
        avgTransaction: salesData.avgTransaction,
        totalProfit: profit,
        profitMargin: parseFloat(margin.toFixed(2)),
      },
      topProducts: {
        byRevenue: topRevenueProducts,
        byProfit: topProfitProducts,
      },
      breakdown: {
        byPaymentMethod: paymentBreakdown,
        byCustomerType: customerTypeBreakdown,
      },
      inventory: inventoryValue,
      wallet: walletStats,
      expenses: expenseStats,
      customers: customerStats,
    };
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error getting dashboard data`, error);
    throw error;
  }
}

/**
 * Refresh analytics cache for a business (scheduled job)
 */
export async function refreshAnalyticsCache(businessId, period = 'daily') {
  try {
    const { startDate } = getDateRange(period);
    const dashboardData = await getDashboardData(businessId, period);

    // Store key metrics in cache

    await db
      .insert(analyticsCache)
      .values({
        business_id: businessId,
        metric_name: 'total_sales',
        period,
        period_date: startDate,
        metric_value: dashboardData.summary.totalRevenue.toString(),
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [analyticsCache.business_id, analyticsCache.metric_name, analyticsCache.period, analyticsCache.period_date],
        set: {
          metric_value: dashboardData.summary.totalRevenue.toString(),
          updated_at: new Date(),
        },
      });

    logger.info(`${SERVICE_NAME}: Analytics cache refreshed for business ${businessId}`);
    return true;
  } catch (error) {
    logger.error(`${SERVICE_NAME}: Error refreshing analytics cache`, error);
    throw error;
  }
}

export default {
  getTotalSales,
  getTotalProfit,
  getProfitMargin,
  getTopProductsByRevenue,
  getTopProductsByProfit,
  getRevenueByPaymentMethod,
  getRevenueByCustomerType,
  getDailySalesTrend,
  getInventoryValue,
  getWalletStats,
  getExpenseStats,
  getCustomerStats,
  getDashboardData,
  refreshAnalyticsCache,
  getDateRange,
};
