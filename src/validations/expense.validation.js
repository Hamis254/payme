import { z } from 'zod';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '#models/expense.model.js';

/**
 * Schema for recording a new expense
 * Allows flexible expense types - businesses can use "n/a" for inapplicable categories
 */
export const recordExpenseSchema = z.object({
  businessId: z
    .number()
    .int()
    .positive('Business ID must be a positive integer'),
  category: z
    .enum(EXPENSE_CATEGORIES)
    .describe('Expense category (use "n/a" if not applicable to business)'),
  description: z
    .string()
    .min(3, 'Description must be at least 3 characters')
    .max(255, 'Description must not exceed 255 characters')
    .describe('Clear description of the expense'),
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .describe('Expense amount in KES'),
  paymentMethod: z
    .enum(PAYMENT_METHODS)
    .describe('How expense was paid'),
  paymentReference: z
    .string()
    .max(128, 'Payment reference must not exceed 128 characters')
    .optional()
    .describe('M-Pesa receipt, cheque number, or bank reference'),
  paymentPhone: z
    .string()
    .max(20, 'Phone must not exceed 20 characters')
    .optional()
    .describe('Phone number for M-Pesa payments'),
  expenseDate: z
    .string()
    .datetime()
    .describe('When the expense occurred (ISO format)'),
  paymentDate: z
    .string()
    .datetime()
    .optional()
    .describe('When payment was made (ISO format, if different)'),
  note: z
    .string()
    .max(500, 'Note must not exceed 500 characters')
    .optional()
    .describe('Additional context or remarks'),
  receiptUrl: z
    .string()
    .url('Receipt URL must be valid')
    .optional()
    .describe('URL to receipt photo or document'),
});

/**
 * Schema for listing/filtering expenses
 */
export const listExpensesSchema = z.object({
  businessId: z
    .number()
    .int()
    .positive('Business ID must be a positive integer'),
  category: z
    .enum(EXPENSE_CATEGORIES)
    .optional()
    .describe('Filter by expense category'),
  paymentMethod: z
    .enum(PAYMENT_METHODS)
    .optional()
    .describe('Filter by payment method'),
  status: z
    .enum(['recorded', 'verified', 'approved', 'paid', 'cancelled'])
    .optional()
    .describe('Filter by status'),
  startDate: z
    .string()
    .datetime()
    .optional()
    .describe('Start date for date range (ISO format)'),
  endDate: z
    .string()
    .datetime()
    .optional()
    .describe('End date for date range (ISO format)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(500, 'Limit cannot exceed 500')
    .default(50)
    .describe('Number of records to return'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Number of records to skip'),
});

/**
 * Schema for updating an expense record
 */
export const updateExpenseSchema = z.object({
  businessId: z
    .number()
    .int()
    .positive('Business ID must be a positive integer'),
  expenseId: z
    .number()
    .int()
    .positive('Expense ID must be a positive integer'),
  category: z
    .enum(EXPENSE_CATEGORIES)
    .optional()
    .describe('Updated expense category'),
  description: z
    .string()
    .min(3, 'Description must be at least 3 characters')
    .max(255, 'Description must not exceed 255 characters')
    .optional()
    .describe('Updated description'),
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .optional()
    .describe('Updated amount in KES'),
  paymentMethod: z
    .enum(PAYMENT_METHODS)
    .optional()
    .describe('Updated payment method'),
  status: z
    .enum(['recorded', 'verified', 'approved', 'paid', 'cancelled'])
    .optional()
    .describe('Updated status'),
  note: z
    .string()
    .max(500, 'Note must not exceed 500 characters')
    .optional()
    .describe('Updated note'),
});

/**
 * Schema for deleting an expense
 */
export const deleteExpenseSchema = z.object({
  businessId: z
    .number()
    .int()
    .positive('Business ID must be a positive integer'),
  expenseId: z
    .number()
    .int()
    .positive('Expense ID must be a positive integer'),
});

/**
 * Schema for getting expense analytics/insights
 */
export const expenseAnalyticsSchema = z.object({
  businessId: z
    .number()
    .int()
    .positive('Business ID must be a positive integer'),
  analysisType: z
    .enum([
      'summary',
      'by_category',
      'by_payment_method',
      'monthly_trend',
      'top_expenses',
      'category_breakdown',
    ])
    .describe('Type of analysis to perform'),
  startDate: z
    .string()
    .datetime()
    .optional()
    .describe('Start date for analysis (ISO format)'),
  endDate: z
    .string()
    .datetime()
    .optional()
    .describe('End date for analysis (ISO format)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(100, 'Limit cannot exceed 100')
    .default(10)
    .optional()
    .describe('Limit for top results'),
});
