// sales.validations.js
import { z } from 'zod';

/**
 * Helpers
 */
const currency = () =>
  z
    .number()
    .nonnegative()
    .refine(v => Number.isFinite(v), { message: 'Invalid amount' });

/**
 * Phone normalization and validation
 * Accepts: +2547XXXXXXXX, 2547XXXXXXXX, 07XXXXXXXX
 * Normalizes to E.164: +2547XXXXXXXX
 */
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

/**
 * Sale item schema
 */
export const saleItemSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
  unit_price: currency(),
  unit_cost: currency().optional(),
});

/**
 * Create sale payload
 */
export const createSaleSchema = z.object({
  businessId: z.number().int().positive(),
  customerName: z.string().max(255).optional().nullable(),
  paymentMode: z.enum(['cash', 'mpesa']),
  customerType: z
    .enum(['walk_in', 'credit', 'hire_purchase'])
    .optional()
    .default('walk_in'),
  items: z
    .array(saleItemSchema)
    .min(1, { message: 'At least one item is required' }),
  note: z.string().max(2000).optional().nullable(),
});

/**
 * Pay by MPESA payload
 */
export const payMpesaSchema = z.object({
  saleId: z.number().int().positive(),
  phone: phoneSchema,
  description: z.string().max(255).optional(),
});

/**
 * Pay by cash payload
 */
export const payCashSchema = z.object({
  saleId: z.number().int().positive(),
  receivedAmount: currency().optional(),
});

/**
 * Sale ID param schema (for route params)
 */
export const saleIdParamSchema = z.object({
  id: z.preprocess(
    v => (typeof v === 'string' ? Number(v) : v),
    z.number().int().positive()
  ),
});

/**
 * MPESA webhook callback basic validation
 */
export const mpesaCallbackSchema = z.object({
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

/**
 * Usage example (Express middleware)
 *
 * import { createSaleSchema } from './sales.validations.js';
 *
 * app.post('/api/sales', (req, res, next) => {
 *   const parse = createSaleSchema.safeParse(req.body);
 *   if (!parse.success) return res.status(400).json({ error: parse.error.format() });
 *   req.validated = parse.data;
 *   next();
 * });
 */
