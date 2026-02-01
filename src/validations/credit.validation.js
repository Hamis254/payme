// validations/credit.validations.js
import { z } from 'zod';

export const createCreditAccountSchema = z.object({
  businessId: z.number().int().positive(),
  customerId: z.number().int().positive(),
  customerName: z.string().max(255),
  creditLimit: z.number().nonnegative().optional().default(0),
});

export const createCreditSaleSchema = z.object({
  saleId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  dueDate: z
    .string()
    .refine(s => !Number.isNaN(Date.parse(s)), { message: 'Invalid date' }),
  outstandingAmount: z.number().nonnegative(),
});

export const recordCreditPaymentSchema = z.object({
  accountId: z.number().int().positive(),
  saleId: z.number().int().positive().optional(),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'mpesa', 'b2c']),
  mpesaTransactionId: z.string().optional(),
  stkRequestId: z.string().optional(),
  reference: z.string().optional(),
});

export const updateCreditAccountSchema = z.object({
  creditLimit: z.number().nonnegative().optional(),
  paymentTermDays: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export const creditQuerySchema = z.object({
  status: z.enum(['active', 'suspended', 'inactive']).optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.number().int().positive().or(z.string()).optional(),
  limit: z.number().int().positive().or(z.string()).optional(),
  asOfDate: z.string().optional(),
});
