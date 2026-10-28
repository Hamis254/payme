/**
 * =============================================================================
 * VALIDATION SCHEMAS: Records system input validation
 * =============================================================================
 * Zod schemas for all record types and operations
 * @module validations/record.validation
 */

import { z } from 'zod';
import { toBusinessDayKey } from '#utils/businessDay.js';

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Full ISO datetimes must carry an offset, so the instant is unambiguous.
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isValidBusinessDate(value) {
  if (BUSINESS_DATE_PATTERN.test(value)) {
    // Reject impossible calendar days such as 2026-02-30.
    const [y, m, d] = value.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return (
      probe.getUTCFullYear() === y &&
      probe.getUTCMonth() === m - 1 &&
      probe.getUTCDate() === d
    );
  }
  return ISO_DATETIME_PATTERN.test(value) && !isNaN(Date.parse(value));
}

/**
 * A calendar day for statements and reports: 'YYYY-MM-DD', or a full ISO
 * datetime (reduced to its Nairobi day downstream).
 *
 * Deliberately a string, not z.coerce.date(). Coercion turns a bare day into
 * UTC midnight, which is 03:00 in Nairobi, and the end-of-day helper then
 * passes that Date through, so the last trading day is lost.
 */
export const businessDateSchema = z
  .string()
  .trim()
  .refine(isValidBusinessDate, 'Expected a date as YYYY-MM-DD (or an ISO datetime)');

/**
 * Cross-field check shared by the ranged schemas. Compares Nairobi days, so
 * '2026-07-20' and '2026-07-20T23:30:00+03:00' are the same day.
 */
const startNotAfterEnd = data =>
  !data.start_date ||
  !data.end_date ||
  toBusinessDayKey(data.start_date) <= toBusinessDayKey(data.end_date);

const checkStartNotAfterEnd = (data, ctx) => {
  if (startNotAfterEnd(data)) return;
  ctx.addIssue({
    code: 'custom',
    message: `end_date (${toBusinessDayKey(data.end_date)}) cannot be before start_date (${toBusinessDayKey(data.start_date)}).`,
    path: ['end_date'],
  });
};

/**
 * LINE ITEM SCHEMA: For itemized records
 */
export const recordItemSchema = z.object({
  item_name: z
    .string()
    .min(1, 'Item name required')
    .max(200, 'Item name too long'),
  description: z.string().optional(),
  quantity: z.number().positive('Quantity must be positive'),
  unit_price: z.number().positive('Unit price must be positive'),
  product_id: z.number().optional(),
  cost_per_unit: z.number().optional(),
});

/**
 * SALES RECORD SCHEMA
 */
export const createSalesRecordSchema = z.object({
  business_id: z.number().positive(),
  type: z.literal('sales'),
  category: z.string().min(1).max(50).default('retail'),
  amount: z.number().positive('Amount must be positive'),
  payment_method: z.enum(['cash', 'mpesa']),
  transaction_date: z.coerce.date(),
  items: z.array(recordItemSchema).optional(),
  description: z.string().optional(),
  product_id: z.number().optional(),
  mpesa_data: z
    .object({
      mpesaReceiptNumber: z.string().optional(),
      transactionDate: z.coerce.date().optional(),
      transactionId: z.string().optional(),
      phoneNumber: z.string().optional(),
      isProcessed: z.boolean().optional(),
    })
    .optional(),
  reference_id: z.string().optional(),
});

/**
 * HIGHER PURCHASE RECORD SCHEMA
 */
export const createHPRecordSchema = z.object({
  business_id: z.number().positive(),
  type: z.literal('hp'),
  category: z.string().min(1).max(50).default('bulk_purchase'),
  amount: z.number().positive('Amount must be positive'),
  transaction_date: z.coerce.date(),
  items: z.array(recordItemSchema).optional(),
  description: z.string().optional(),
  reference_id: z.string().optional(),
});

/**
 * CREDIT RECORD SCHEMA
 */
export const createCreditRecordSchema = z.object({
  business_id: z.number().positive(),
  type: z.literal('credit'),
  category: z.string().min(1).max(50).default('customer_credit'),
  amount: z.number().positive('Amount must be positive'),
  transaction_date: z.coerce.date(),
  credit_due_date: z.coerce.date().optional(),
  items: z.array(recordItemSchema).optional(),
  description: z.string().optional(),
  reference_id: z.string().optional(),
});

/**
 * INVENTORY RECORD SCHEMA
 */
export const createInventoryRecordSchema = z.object({
  business_id: z.number().positive(),
  type: z.literal('inventory'),
  category: z.string().min(1).max(50).default('stock_purchase'),
  amount: z.number().positive('Amount must be positive'),
  transaction_date: z.coerce.date(),
  items: z.array(recordItemSchema).optional(),
  description: z.string().optional(),
  product_id: z.number().optional(),
  reference_id: z.string().optional(),
});

/**
 * EXPENSE RECORD SCHEMA
 */
export const createExpenseRecordSchema = z.object({
  business_id: z.number().positive(),
  type: z.literal('expense'),
  category: z.string().min(1).max(50).default('operating_expense'),
  amount: z.number().positive('Amount must be positive'),
  transaction_date: z.coerce.date(),
  items: z.array(recordItemSchema).optional(),
  description: z.string().optional(),
  reference_id: z.string().optional(),
});

/**
 * GENERIC CREATE RECORD SCHEMA (Union of all types)
 */
export const createRecordSchema = z.union([
  createSalesRecordSchema,
  createHPRecordSchema,
  createCreditRecordSchema,
  createInventoryRecordSchema,
  createExpenseRecordSchema,
]);

/**
 * QUERY RECORDS SCHEMA
 * Used by the existing GET /api/records/:business_id list endpoint — this is
 * also what powers the on-screen zebra-striped table, filtered to a date
 * range for the Statement page's live preview.
 */
export const queryRecordsSchema = z.object({
  type: z.enum(['sales', 'hp', 'credit', 'inventory', 'expense']).optional(),
  payment_method: z.enum(['cash', 'mpesa']).optional(),
  start_date: businessDateSchema.optional(),
  end_date: businessDateSchema.optional(),
  limit: z.coerce.number().positive().max(500).default(100),
  offset: z.coerce.number().nonnegative().default(0),
});

/**
 * DATE RANGE SCHEMA (For statements)
 */
export const dateRangeSchema = z.object({
  start_date: businessDateSchema,
  end_date: businessDateSchema.optional(),
});

/**
 * STATEMENT PREVIEW SCHEMA (GET /api/records/:business_id/statement-preview)
 * Both edges optional. The service defaults start to today and end to today,
 * and clamps an end date in the future to today.
 */
export const statementRangeSchema = z
  .object({
    start_date: businessDateSchema.optional(),
    end_date: businessDateSchema.optional(),
  })
  .superRefine(checkStartNotAfterEnd);

/**
 * DASHBOARD INSIGHTS SCHEMA
 */
export const dashboardInsightsSchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
});

/**
 * GENERATE STATEMENT SCHEMA
 * Deliberately PDF-only — this endpoint has one job: produce the bank-grade
 * PDF. 'statement_type' picks between the financial-summary-only document
 * and the full document with the complete, unbounded transaction ledger.
 * A cross-field check ensures end_date can't be set before start_date, with
 * a message that names both dates so the caller can fix it in one pass.
 */
export const generateStatementSchema = z
  .object({
    business_id: z.number().positive(),
    start_date: businessDateSchema,
    end_date: businessDateSchema.optional(),
    statement_type: z.enum(['summary', 'full']).default('full'),
  })
  .superRefine(checkStartNotAfterEnd);

export default {
  createRecordSchema,
  createSalesRecordSchema,
  createHPRecordSchema,
  createCreditRecordSchema,
  createInventoryRecordSchema,
  createExpenseRecordSchema,
  queryRecordsSchema,
  dateRangeSchema,
  dashboardInsightsSchema,
  generateStatementSchema,
  statementRangeSchema,
  businessDateSchema,
  recordItemSchema,
};