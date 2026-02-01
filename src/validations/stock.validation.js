import { z } from 'zod';

// Create a new product
export const createProductSchema = z.object({
  business_id: z.number().int().positive(),
  name: z.string().min(1).max(255).trim(),
  buying_price_per_unit: z.number().positive(),
  selling_price_per_unit: z.number().positive(),
});

// Update a product
export const updateProductSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  buying_price_per_unit: z.number().positive().optional(),
  selling_price_per_unit: z.number().positive().optional(),
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
