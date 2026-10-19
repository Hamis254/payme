import logger from '#config/logger.js';
import analyticsService from '#services/analytics.service.js';
import {
  dashboardQuerySchema,
  productAnalyticsQuerySchema,
  trendQuerySchema,
} from '#validations/analytics.validation.js';
import { formatValidationError } from '#utils/format.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';

/**
 * Verify user owns this business
 */
async function verifyBusinessOwnership(businessId, userId) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) {
    throw new Error('Business not found or access denied');
  }

  return business;
}

/**
 * GET /api/analytics/dashboard
 * Get comprehensive dashboard data
 */
export async function getDashboard(req, res, next) {
  try {
    const { businessId } = req.params;
    const queryValidation = dashboardQuerySchema.safeParse(req.query);

    if (!queryValidation.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(queryValidation.error),
      });
    }

    // Verify ownership
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { period = 'daily' } = queryValidation.data;

    const dashboardData = await analyticsService.getDashboardData(
      parseInt(businessId),
      period
    );

    return res.status(200).json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    logger.error('Analytics: Get dashboard error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/summary
 * Quick summary: revenue, profit, transaction count
 */
export async function getSummary(req, res, next) {
  try {
    const { businessId } = req.params;
    const queryValidation = dashboardQuerySchema.safeParse(req.query);

    if (!queryValidation.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(queryValidation.error),
      });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { period = 'daily' } = queryValidation.data;
    const { startDate, endDate } = analyticsService.getDateRange(period);

    const pnl = await analyticsService.getProfitAndLoss(
      parseInt(businessId),
      startDate,
      endDate
    );

    return res.status(200).json({
      success: true,
      data: {
        period,
        totalRevenue: pnl.accrual_goods_sold_value,
        totalProfit: pnl.net_profit,
        profitMargin: pnl.net_margin_percent,
        transactionCount: pnl.transaction_count,
        avgTransaction: pnl.avg_transaction,
      },
    });
  } catch (error) {
    logger.error('Analytics: Get summary error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/top-products
 * Get top products by revenue or profit
 *
 * Previously called getTopProductsByRevenue / getTopProductsByProfit,
 * neither of which exist — the service only has getTopProducts, which
 * now takes a sortBy param directly.
 */
export async function getTopProducts(req, res, next) {
  try {
    const { businessId } = req.params;
    const queryValidation = productAnalyticsQuerySchema.safeParse(req.query);

    if (!queryValidation.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(queryValidation.error),
      });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { limit = 10, sortBy = 'revenue' } = queryValidation.data;
    const { period = 'daily' } = req.query;
    const { startDate, endDate } = analyticsService.getDateRange(period);

    const products = await analyticsService.getTopProducts(
      parseInt(businessId),
      startDate,
      endDate,
      limit,
      sortBy === 'profit' ? 'profit' : 'revenue'
    );

    return res.status(200).json({
      success: true,
      data: {
        sortBy,
        limit,
        products,
      },
    });
  } catch (error) {
    logger.error('Analytics: Get top products error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/revenue-breakdown
 * Get revenue split by payment method
 *
 * Previously called getRevenueByPaymentMethod / getRevenueByCustomerType,
 * neither of which exist. The service's getRevenueBreakdown already
 * returns the payment-method split in one object; customer-type breakdown
 * isn't tracked separately in the schema (sales are cash/mpesa/credit/HP,
 * not by an independent customer_type dimension), so this now returns
 * the payment-method breakdown only.
 */
export async function getRevenueBreakdown(req, res, next) {
  try {
    const { businessId } = req.params;
    const queryValidation = dashboardQuerySchema.safeParse(req.query);

    if (!queryValidation.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(queryValidation.error),
      });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { period = 'daily' } = queryValidation.data;
    const { startDate, endDate } = analyticsService.getDateRange(period);

    const breakdown = await analyticsService.getRevenueBreakdown(
      parseInt(businessId),
      startDate,
      endDate
    );

    return res.status(200).json({
      success: true,
      data: {
        period,
        byPaymentMethod: {
          cash: breakdown.cash,
          mpesa: breakdown.mpesa,
          credit: breakdown.credit,
          hire_purchase: breakdown.hire_purchase,
        },
        counts: {
          cash: breakdown.cash_count,
          mpesa: breakdown.mpesa_count,
          credit: breakdown.credit_count,
          hire_purchase: breakdown.hp_count,
        },
        grossRevenue: breakdown.gross_revenue,
        totalTransactions: breakdown.total_transactions,
        avgTransaction: breakdown.avg_transaction,
      },
    });
  } catch (error) {
    logger.error('Analytics: Get revenue breakdown error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/sales-trend
 * Get daily sales trend for last N days
 *
 * Previously called getDailySalesTrend, which doesn't exist — the
 * service exports this as getDailyTrend.
 */
export async function getSalesTrend(req, res, next) {
  try {
    const { businessId } = req.params;
    const queryValidation = trendQuerySchema.safeParse(req.query);

    if (!queryValidation.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(queryValidation.error),
      });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { daysBack = 30 } = queryValidation.data;
    const trend = await analyticsService.getDailyTrend(
      parseInt(businessId),
      daysBack
    );

    return res.status(200).json({
      success: true,
      data: {
        daysBack,
        trend,
      },
    });
  } catch (error) {
    logger.error('Analytics: Get sales trend error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/inventory
 * Get inventory value and statistics
 */
export async function getInventory(req, res, next) {
  try {
    const { businessId } = req.params;

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const inventory = await analyticsService.getInventoryValue(
      parseInt(businessId)
    );

    return res.status(200).json({
      success: true,
      data: inventory,
    });
  } catch (error) {
    logger.error('Analytics: Get inventory error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/wallet
 * Get wallet and token statistics
 *
 * Previously called getWalletStats, which didn't exist anywhere.
 * Added a lightweight getWalletStats to the analytics service (balance,
 * total purchased, total spent, transaction count) rather than reusing
 * myWallet.service.js, since that module's functions are M-Pesa
 * purchase-flow oriented and need a userId this route doesn't have.
 */
export async function getWallet(req, res, next) {
  try {
    const { businessId } = req.params;

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const wallet = await analyticsService.getWalletStats(parseInt(businessId));

    return res.status(200).json({
      success: true,
      data: wallet,
    });
  } catch (error) {
    logger.error('Analytics: Get wallet error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/expenses
 * Get expense statistics
 */
export async function getExpenses(req, res, next) {
  try {
    const { businessId } = req.params;
    const queryValidation = dashboardQuerySchema.safeParse(req.query);

    if (!queryValidation.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(queryValidation.error),
      });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { period = 'daily' } = queryValidation.data;
    const { startDate, endDate } = analyticsService.getDateRange(period);

    const expenses = await analyticsService.getExpenseStats(
      parseInt(businessId),
      startDate,
      endDate
    );

    return res.status(200).json({
      success: true,
      data: {
        period,
        ...expenses,
      },
    });
  } catch (error) {
    logger.error('Analytics: Get expenses error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/analytics/customers
 * Get customer statistics
 */
export async function getCustomers(req, res, next) {
  try {
    const { businessId } = req.params;
    const queryValidation = dashboardQuerySchema.safeParse(req.query);

    if (!queryValidation.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: formatValidationError(queryValidation.error),
      });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { period = 'daily' } = queryValidation.data;
    const { startDate, endDate } = analyticsService.getDateRange(period);

    const customers = await analyticsService.getCustomerStats(
      parseInt(businessId),
      startDate,
      endDate
    );

    return res.status(200).json({
      success: true,
      data: {
        period,
        ...customers,
      },
    });
  } catch (error) {
    logger.error('Analytics: Get customers error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

export default {
  getDashboard,
  getSummary,
  getTopProducts,
  getRevenueBreakdown,
  getSalesTrend,
  getInventory,
  getWallet,
  getExpenses,
  getCustomers,
};