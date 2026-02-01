// reconciliation.validation.js
import { z } from 'zod';

// Cash reconciliation schema
export const createCashReconciliationSchema = z.object({
  reconciliation_date: z.string().refine(val => !isNaN(Date.parse(val)), {
    message: 'Invalid date format',
  }),
  counted_cash: z.number().positive('Counted cash must be positive'),
  note: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// M-Pesa reconciliation schema
export const createMpesaReconciliationSchema = z.object({
  period_start: z.string().refine(val => !isNaN(Date.parse(val)), {
    message: 'Invalid start date format',
  }),
  period_end: z.string().refine(val => !isNaN(Date.parse(val)), {
    message: 'Invalid end date format',
  }),
  bank_transactions: z.number().int().nonnegative(),
  bank_amount: z.number().nonnegative(),
  investigation_notes: z.string().optional(),
  missing_transactions: z.array(z.object({
    date: z.string(),
    amount: z.number(),
    phone: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  extra_transactions: z.array(z.object({
    date: z.string(),
    amount: z.number(),
    phone: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
});

// Reconciliation config schema
export const reconciliationConfigSchema = z.object({
  cash_variance_threshold: z.number().min(0).max(100).optional(),
  mpesa_variance_threshold: z.number().min(0).max(100).optional(),
  daily_reconciliation_required: z.boolean().optional(),
  auto_flag_enabled: z.boolean().optional(),
  supervisor_approval_required: z.boolean().optional(),
});

// List reconciliations schema
export const listReconciliationsSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
