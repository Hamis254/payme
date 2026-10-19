import { z } from 'zod';

/**
 * Payment Configuration Validation
 *
 * PAYBILL setup requires:
 *   - paybill_number   : Your M-Pesa paybill number (e.g. 123456)
 *   - account_number   : Account reference shown on customer's phone (max 12 chars, e.g. your store name or order ref)
 *   - passkey          : Lipa Na M-Pesa Online passkey from Daraja portal
 *
 * TILL NUMBER setup requires:
 *   - till_number      : Your M-Pesa till number (e.g. 123456)
 *   - store_name       : Your store name shown on customer's phone (optional, max 12 chars)
 *   - passkey          : Lipa Na M-Pesa Online passkey from Daraja portal
 */

// Base object shape — kept separate from the refinement below so that
// updatePaymentConfigSchema can call .partial() on it. Zod v4 throws
// ".partial() cannot be used on object schemas containing refinements",
// so .partial() must run on this plain object, never on the refined
// version further down.
const paymentConfigShape = z.object({
  payment_method: z.enum(['till_number', 'paybill'], {
    errorMap: () => ({
      message: 'Payment method must be either \'till_number\' or \'paybill\'',
    }),
  }),

  // The shortcode — till number OR paybill number
  shortcode: z
    .string()
    .trim()
    .min(5, 'Shortcode must be at least 5 digits')
    .max(10, 'Shortcode must not exceed 10 digits')
    .regex(/^\d+$/, 'Shortcode must contain digits only'),

  // Passkey from Daraja portal (same for both)
  passkey: z
    .string()
    .trim()
    .min(1, 'Passkey is required — get this from your Daraja portal'),

  // Paybill: account number shown to customer (required for paybill)
  // Till: store reference shown to customer (optional)
  account_reference: z
    .string()
    .trim()
    .max(
      12,
      'Account reference must not exceed 12 characters — Safaricom limit'
    )
    .regex(
      /^[a-zA-Z0-9\s]*$/,
      'Account reference can only contain letters, numbers, and spaces'
    )
    .optional()
    .or(z.literal('')),

  // Display name for your own reference (not sent to Safaricom)
  account_name: z.string().trim().max(255).optional().or(z.literal('')),
});

export const setupPaymentConfigSchema = paymentConfigShape.superRefine(
  (data, ctx) => {
    if (data.payment_method === 'paybill') {
      if (!data.account_reference || data.account_reference.trim() === '') {
        ctx.addIssue({
          path: ['account_reference'],
          code: z.ZodIssueCode.custom,
          message:
            'Account number is required for paybill. This is shown on your customer\'s phone when they pay. Example: your store name or "SHOP001" (max 12 chars)',
        });
      }
    }
  }
);

// .partial() runs on the unrefined base shape (see comment above) — every
// field becomes optional, which is correct for a PATCH-style update.
// NOTE: this means updating payment_method to 'paybill' without also
// supplying account_reference in the same request will NOT be rejected the
// way it is on initial setup — the "paybill requires account_reference"
// rule only runs on setupPaymentConfigSchema. If you want that enforced on
// updates too, add a matching .superRefine() here once you've decided the
// desired behavior (e.g. only enforce it when payment_method is present in
// the update payload).
export const updatePaymentConfigSchema = paymentConfigShape.partial().extend({
  is_active: z.boolean().optional(),
});

/**
 * Field descriptions returned to frontend for UI guidance
 */
export const getPaymentConfigFields = paymentMethod => {
  if (paymentMethod === 'paybill') {
    return {
      shortcode: {
        label: 'Paybill Number',
        placeholder: 'e.g. 123456',
        hint: 'Your M-Pesa Paybill number from Safaricom',
        required: true,
      },
      account_reference: {
        label: 'Account Number',
        placeholder: 'e.g. SHOP001 (max 12 chars)',
        hint: 'This is shown on your customer\'s phone when they pay. Use your store name or a short identifier.',
        required: true,
        maxLength: 12,
      },
      passkey: {
        label: 'Lipa Na M-Pesa Passkey',
        placeholder: 'Paste your passkey from Daraja portal',
        hint: 'Get this from developer.safaricom.co.ke → Your App → M-Pesa Express → Passkey',
        required: true,
      },
      account_name: {
        label: 'Display Name (optional)',
        placeholder: 'e.g. My Shop Paybill',
        hint: 'For your own reference only — not sent to Safaricom',
        required: false,
      },
    };
  }

  // till_number
  return {
    shortcode: {
      label: 'Till Number',
      placeholder: 'e.g. 123456',
      hint: 'Your M-Pesa Till number from Safaricom',
      required: true,
    },
    account_reference: {
      label: 'Store Name (optional)',
      placeholder: 'e.g. MY SHOP (max 12 chars)',
      hint: 'Shown on your customer\'s phone. Leave blank to use your till number.',
      required: false,
      maxLength: 12,
    },
    passkey: {
      label: 'Lipa Na M-Pesa Passkey',
      placeholder: 'Paste your passkey from Daraja portal',
      hint: 'Get this from developer.safaricom.co.ke → Your App → M-Pesa Express → Passkey',
      required: true,
    },
    account_name: {
      label: 'Display Name (optional)',
      placeholder: 'e.g. My Shop Till',
      hint: 'For your own reference only — not sent to Safaricom',
      required: false,
    },
  };
};