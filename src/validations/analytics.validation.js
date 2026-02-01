import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('daily').optional(),
});

export const metricsQuerySchema = z.object({
  businessId: z.coerce.number().positive(),
  metric: z.enum([
    'total_sales',
    'total_profit',
    'profit_margin',
    'top_products',
    'payment_breakdown',
    'customer_breakdown',
    'daily_trend',
    'inventory',
    'wallet',
    'expenses',
    'customers',
  ]),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('daily').optional(),
  limit: z.coerce.number().positive().default(10).optional(),
});

export const dateRangeQuerySchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
});

export const productAnalyticsQuerySchema = z.object({
  limit: z.coerce.number().positive().default(10).optional(),
  sortBy: z.enum(['revenue', 'profit', 'units']).default('revenue').optional(),
});

export const trendQuerySchema = z.object({
  daysBack: z.coerce.number().positive().default(30).optional(),
  period: z.enum(['daily', 'weekly']).default('daily').optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json').optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('daily').optional(),
});
