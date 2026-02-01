import { z } from 'zod';

const kenyaPhoneRegex = /^(\+?254|0)[17][0-9]{8}$/;

// Cart item schema
const cartItemSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
});

// PayMe request schema
export const paymeSchema = z.object({
  business_id: z.number().int().positive(),
  items: z.array(cartItemSchema).min(1),
  payment_mode: z.enum(['cash', 'mpesa']),
  // Required only for MPESA
  customer_phone: z
    .string()
    .regex(kenyaPhoneRegex, 'Invalid Kenyan phone number')
    .optional(),
  customer_type: z
    .enum(['walk_in', 'credit', 'hire_purchase'])
    .default('walk_in'),
  note: z.string().max(255).trim().optional(),
});

// Validate cart schema (for preview before payment)
export const validateCartSchema = z.object({
  business_id: z.number().int().positive(),
  items: z.array(cartItemSchema).min(1),
});
