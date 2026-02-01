import { z } from 'zod';

// Phone number validation with normalization
const phonePreprocess = val => {
  if (typeof val !== 'string') return val;
  const raw = val.trim();
  if (/^0[17]\d{8}$/.test(raw)) return `+254${raw.slice(1)}`;
  if (/^7\d{8}$/.test(raw)) return `+254${raw}`;
  if (/^2547\d{8}$/.test(raw)) return `+${raw}`;
  if (/^\+2547\d{8}$/.test(raw)) return raw;
  return raw;
};

const phoneSchema = z.preprocess(
  phonePreprocess,
  z.string()
    .regex(/^\+2547\d{8}$/, {
      message: 'Phone must be a valid Kenyan mobile number in E.164 format (+2547XXXXXXXX)',
    })
);

// Token package options with their prices
export const tokenPackages = {
  30: { tokens: 30, price: 50 },
  70: { tokens: 70, price: 100 },
  150: { tokens: 150, price: 200 },
  400: { tokens: 400, price: 500 },
  850: { tokens: 850, price: 1000 },
};

// Initiate token purchase (M-Pesa)
export const initiateTokenPurchaseSchema = z.object({
  businessId: z.number().int().positive(),
  packageType: z.enum(['30', '70', '150', '400', '850']),
  phone: phoneSchema,
});

// Manual token addition (admin/cash payment)
export const addTokensManuallySchema = z.object({
  businessId: z.number().int().positive(),
  tokens: z.number().int().positive(),
  note: z.string().max(500).optional(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'admin']).default('cash'),
});

// Get wallet balance
export const getWalletSchema = z.object({
  businessId: z.number().int().positive(),
});

// Get wallet transactions with filters
export const getWalletTransactionsSchema = z.object({
  businessId: z.number().int().positive(),
  type: z
    .enum(['purchase', 'reserve', 'charge', 'refund', 'all'])
    .optional()
    .default('all'),
  limit: z.number().int().positive().max(100).optional().default(50),
  offset: z.number().int().nonnegative().optional().default(0),
});

// M-Pesa callback for token purchase
export const tokenPurchaseCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string(),
      ResultCode: z.number(),
      ResultDesc: z.string(),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({
              Name: z.string(),
              Value: z.any().optional(),
            })
          ),
        })
        .optional(),
    }),
  }),
});

// Get token purchase history
export const getTokenPurchasesSchema = z.object({
  businessId: z.number().int().positive(),
  status: z
    .enum(['pending', 'success', 'failed', 'all'])
    .optional()
    .default('all'),
  limit: z.number().int().positive().max(100).optional().default(20),
});
