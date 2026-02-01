import { z } from 'zod';

/**
 * Payment Configuration Validation Schemas
 * Validates business M-Pesa payment method setup
 */

// Payment method enum: aligned with businesses table
// 'till_number' - for till number payments
// 'paybill' - for paybill payments
// Note: 'wallet' is handled separately for token purchases
const paymentMethodSchema = z.enum(['till_number', 'paybill']).describe(
  'Payment method: till_number or paybill (M-Pesa Daraja STK Push)'
);

/**
 * Setup payment configuration (after user signup)
 * User selects payment method and provides credentials
 */
export const setupPaymentConfigSchema = z.object({
  payment_method: paymentMethodSchema,
  shortcode: z.string()
    .trim()
    .min(5, 'Shortcode must be at least 5 characters')
    .max(20, 'Shortcode must not exceed 20 characters')
    .regex(/^[0-9a-zA-Z]+$/, 'Shortcode must be alphanumeric')
    .describe('M-Pesa shortcode (till or paybill number)'),
  passkey: z.string()
    .trim()
    .min(1, 'Passkey is required')
    .describe('M-Pesa Daraja passkey from portal'),
  account_reference: z.string()
    .trim()
    .min(1, 'Account reference/store number is required')
    .max(50, 'Account reference must not exceed 50 characters')
    .regex(/^[a-zA-Z0-9]+$/, 'Account reference must be alphanumeric')
    .describe('For paybill: Account reference (max 12 chars). For till: Store number.'),
  account_name: z.string()
    .trim()
    .max(255, 'Account name must not exceed 255 characters')
    .optional()
    .or(z.literal(''))
    .describe('Optional account display name'),
});

/**
 * Update existing payment configuration
 * Can update passkey and account name without changing method
 */
export const updatePaymentConfigSchema = setupPaymentConfigSchema.partial().extend({
  is_active: z.boolean()
    .optional()
    .describe('Toggle payment config active status'),
});

/**
 * Get payment config response
 */
export const getPaymentConfigSchema = z.object({
  id: z.number(),
  business_id: z.number(),
  payment_method: paymentMethodSchema,
  shortcode: z.string(),
  account_reference: z.string(),
  account_name: z.string().optional(),
  verified: z.boolean(),
  is_active: z.boolean(),
  created_at: z.date().or(z.string()),
  updated_at: z.date().or(z.string()),
});
