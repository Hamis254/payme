import { z } from 'zod';

// Create hire purchase agreement
export const createHirePurchaseSchema = z.object({
  saleId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  principalAmount: z.number().positive(),
  interestRate: z.number().nonnegative().default(0),
  downPayment: z.number().nonnegative().default(0),
  installmentAmount: z.number().positive(),
  installmentFrequency: z.enum(['daily', 'weekly', 'bi-weekly', 'monthly']),
  numberOfInstallments: z.number().int().positive(),
  agreementDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid date',
  }),
  firstPaymentDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid date',
  }),
  lateFeeAmount: z.number().nonnegative().optional().default(0),
  gracePeriodDays: z.number().int().nonnegative().optional().default(0),
  termsAndConditions: z.string().optional(),
  notes: z.string().optional(),
});

// Record installment payment
export const recordInstallmentPaymentSchema = z.object({
  agreementId: z.number().int().positive(),
  installmentId: z.number().int().positive(),
  amountPaid: z.number().positive(),
  paymentMethod: z.enum(['cash', 'mpesa']),
  mpesaTransactionId: z.string().optional(),
  paymentDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
      message: 'Invalid date',
    })
    .optional(),
});

// Update hire purchase agreement
export const updateHirePurchaseSchema = z.object({
  status: z.enum(['active', 'completed', 'defaulted', 'cancelled']).optional(),
  lateFeeAmount: z.number().nonnegative().optional(),
  gracePeriodDays: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

// Query parameters
export const hirePurchaseQuerySchema = z.object({
  status: z.enum(['active', 'completed', 'defaulted', 'cancelled']).optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  overdue: z.boolean().or(z.string()).optional(),
  page: z.number().int().positive().or(z.string()).optional(),
  limit: z.number().int().positive().or(z.string()).optional(),
});
