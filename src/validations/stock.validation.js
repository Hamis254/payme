import { z } from 'zod';

// Create a new product
export const createProductSchema = z.object({
  business_id: z.number().int().positive(),
  name: z.string().min(1).max(255).trim(),
  buying_price_per_unit: z.number().positive(),
  selling_price_per_unit: z.number().positive(),
  // Optional — free-text unit of measure. Defaults to 'pcs' server-side
  // if omitted, so a first-time mama mboga user never has to think about it.
  unit: z.string().min(1).max(50).trim().optional(),
  // Optional — only set once a business wants SKU-level tracking.
  sku: z.string().max(100).trim().optional(),
  // Optional — ISO date string, only for products that actually expire.
  expiry_date: z.string().datetime().optional().nullable(),
});

// Update a product
export const updateProductSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  buying_price_per_unit: z.number().positive().optional(),
  selling_price_per_unit: z.number().positive().optional(),
  unit: z.string().min(1).max(50).trim().optional(),
  sku: z.string().max(100).trim().optional().nullable(),
  expiry_date: z.string().datetime().optional().nullable(),
  is_active: z.number().int().min(0).max(1).optional(),
});

// Add stock to a product
export const addStockSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().positive(),
  buying_price_per_unit: z.number().positive().optional(),
  note: z.string().max(255).trim().optional(),
});

// Record manual stock adjustment (correction, loss, etc.)
export const recordAdjustmentSchema = z.object({
  product_id: z.number().int().positive(),
  quantity_change: z.number(), // positive to add, negative to subtract
  reason: z.string().min(1).max(500).trim(),
});

// List products with pagination
export const listProductsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});