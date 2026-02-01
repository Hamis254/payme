import { z } from 'zod';

export const createNotificationSchema = z.object({
  user_id: z.number().int().positive(),
  type: z.enum([
    'payment_complete',
    'payment_failed',
    'low_stock',
    'stock_expiring',
    'sale_created',
    'wallet_low',
    'wallet_purchased',
    'credit_payment_due',
    'expense_recorded',
    'daily_summary',
  ]),
  channel: z.enum(['in_app', 'sms', 'email', 'all']).default('all'),
  title: z.string().min(1).max(255),
  message: z.string().min(1).max(1000),
  related_id: z.number().int().positive().optional(),
  related_type: z.string().max(50).optional(),
});

export const updatePreferencesSchema = z.object({
  sms_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  in_app_enabled: z.boolean().optional(),
  payment_notifications: z.boolean().optional(),
  stock_notifications: z.boolean().optional(),
  sales_notifications: z.boolean().optional(),
  wallet_notifications: z.boolean().optional(),
  credit_notifications: z.boolean().optional(),
  expense_notifications: z.boolean().optional(),
  daily_summary: z.boolean().optional(),
  sms_phone: z.string().regex(/^(\+?254|0)[17][0-9]{8}$/).optional(),
  quiet_hours_enabled: z.boolean().optional(),
  quiet_start: z.string().regex(/^\d{2}:\d{2}$/).optional(), // HH:mm
  quiet_end: z.string().regex(/^\d{2}:\d{2}$/).optional(), // HH:mm
});

export const testNotificationSchema = z.object({
  type: z.enum([
    'payment_complete',
    'payment_failed',
    'low_stock',
    'stock_expiring',
    'sale_created',
    'wallet_low',
    'wallet_purchased',
    'credit_payment_due',
    'expense_recorded',
    'daily_summary',
  ]).optional(),
  channel: z.enum(['in_app', 'sms', 'email', 'all']).default('all'),
});
