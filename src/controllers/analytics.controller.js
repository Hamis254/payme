import logger from '#config/logger.js';
import analyticsService from '#services/analytics.service.js';
import {
  dashboardQuerySchema,
  productAnalyticsQuerySchema,
  trendQuerySchema,
} from '#validations/analytics.validation.js';
import { formatValidationError } from '#utils/errorHandler.js';
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

    const dashboardData = await analyticsService.getDashboardData(parseInt(businessId), period);

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

    const [sales, profit, margin] = await Promise.all([
      analyticsService.getTotalSales(parseInt(businessId), startDate, endDate),
      analyticsService.getTotalProfit(parseInt(businessId), startDate, endDate),
      analyticsService.getProfitMargin(parseInt(businessId), startDate, endDate),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        period,
        totalRevenue: sales.totalRevenue,
        totalProfit: profit,
        profitMargin: parseFloat(margin.toFixed(2)),
        transactionCount: sales.transactionCount,
        avgTransaction: sales.avgTransaction,
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

    const products =
      sortBy === 'profit'
        ? await analyticsService.getTopProductsByProfit(parseInt(businessId), startDate, endDate, limit)
        : await analyticsService.getTopProductsByRevenue(parseInt(businessId), startDate, endDate, limit);

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
 * Get revenue split by payment method and customer type
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

    const [byPaymentMethod, byCustomerType] = await Promise.all([
      analyticsService.getRevenueByPaymentMethod(parseInt(businessId), startDate, endDate),
      analyticsService.getRevenueByCustomerType(parseInt(businessId), startDate, endDate),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        period,
        byPaymentMethod,
        byCustomerType,
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
    const trend = await analyticsService.getDailySalesTrend(parseInt(businessId), daysBack);

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

    const inventory = await analyticsService.getInventoryValue(parseInt(businessId));

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

    const expenses = await analyticsService.getExpenseStats(parseInt(businessId), startDate, endDate);

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

    const customers = await analyticsService.getCustomerStats(parseInt(businessId), startDate, endDate);

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
