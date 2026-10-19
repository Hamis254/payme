import { z } from 'zod';

const kenyaPhoneRegex = /^(\+?254|0)[17][0-9]{8}$/;

const isValidDateString = (s) => !Number.isNaN(Date.parse(s));

// Cart item schema
const cartItemSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
});

// PayMe request schema
export const paymeSchema = z
  .object({
    business_id: z.number().int().positive(),
    items: z.array(cartItemSchema).min(1),
    payment_mode: z.enum(['cash', 'mpesa', 'credit', 'hire_purchase']),

    // Required only for MPESA
    customer_phone: z
      .string()
      .regex(kenyaPhoneRegex, 'Invalid Kenyan phone number')
      .optional(),

    // Captured for every sale where the owner provides it — persisted on
    // the sales row so Records/Statement/customer-facing views can show
    // who a sale was for, not just "walk_in".
    customer_name: z.string().max(255).trim().optional(),

    customer_type: z
      .enum(['walk_in', 'credit', 'hire_purchase'])
      .default('walk_in'),

    note: z.string().max(255).trim().optional(),

    // ── Credit fields — required only when payment_mode === 'credit' ──
    credit_account_id: z.number().int().positive().optional(),
    credit_due_date: z
      .string()
      .refine(isValidDateString, { message: 'Invalid date' })
      .optional(),
    override_stock_warning: z.boolean().optional(),

    // ── Hire purchase fields — required only when payment_mode === 'hire_purchase' ──
    hp_account_id: z.number().int().positive().optional(),
    hp_interest_rate: z.number().nonnegative().optional(),
    hp_down_payment: z.number().nonnegative().optional(),
    hp_installment_amount: z.number().positive().optional(),
    hp_installment_frequency: z
      .enum(['daily', 'weekly', 'bi-weekly', 'monthly'])
      .optional(),
    hp_number_of_installments: z.number().int().positive().optional(),
    hp_first_payment_date: z
      .string()
      .refine(isValidDateString, { message: 'Invalid date' })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.payment_mode === 'mpesa' && !data.customer_phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customer_phone'],
        message: 'customer_phone is required for mpesa',
      });
    }

    if (data.payment_mode === 'credit') {
      if (!data.credit_account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['credit_account_id'],
          message: 'credit_account_id is required for credit sales',
        });
      }
      if (!data.credit_due_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['credit_due_date'],
          message: 'credit_due_date is required for credit sales',
        });
      }
    }

    if (data.payment_mode === 'hire_purchase') {
      if (!data.hp_account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hp_account_id'],
          message: 'hp_account_id is required for hire purchase sales',
        });
      }
      const requiredNumericOrEnumFields = [
        'hp_installment_amount',
        'hp_installment_frequency',
        'hp_number_of_installments',
        'hp_first_payment_date',
      ];
      for (const field of requiredNumericOrEnumFields) {
        if (data[field] === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for hire purchase sales`,
          });
        }
      }
    }
  });

// Validate cart schema (for preview before payment)
export const validateCartSchema = z.object({
  business_id: z.number().int().positive(),
  items: z.array(cartItemSchema).min(1),
});