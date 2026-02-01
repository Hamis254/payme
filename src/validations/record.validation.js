/**
 * =============================================================================
 * VALIDATION SCHEMAS: Records system input validation
 * =============================================================================
 * Zod schemas for all record types and operations
 * @module validations/record.validation
 */

import { z } from 'zod';

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
  category: z
    .string()
    .min(1)
    .max(50)
    .default('retail'),
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
  category: z
    .string()
    .min(1)
    .max(50)
    .default('bulk_purchase'),
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
  category: z
    .string()
    .min(1)
    .max(50)
    .default('customer_credit'),
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
  category: z
    .string()
    .min(1)
    .max(50)
    .default('stock_purchase'),
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
  category: z
    .string()
    .min(1)
    .max(50)
    .default('operating_expense'),
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
 */
export const queryRecordsSchema = z.object({
  type: z
    .enum(['sales', 'hp', 'credit', 'inventory', 'expense'])
    .optional(),
  payment_method: z.enum(['cash', 'mpesa']).optional(),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
  limit: z
    .number()
    .positive()
    .max(500)
    .default(100),
  offset: z.number().nonnegative().default(0),
});

/**
 * DATE RANGE SCHEMA (For statements)
 */
export const dateRangeSchema = z.object({
  start_date: z.coerce.date(),
  end_date: z.coerce.date().optional(),
});

/**
 * DASHBOARD INSIGHTS SCHEMA
 */
export const dashboardInsightsSchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
});

/**
 * GENERATE STATEMENT SCHEMA
 */
export const generateStatementSchema = z.object({
  business_id: z.number().positive(),
  start_date: z.coerce.date(),
  end_date: z.coerce.date().optional(),
  format: z.enum(['pdf', 'csv', 'json']).default('pdf'),
});

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
  recordItemSchema,
};
