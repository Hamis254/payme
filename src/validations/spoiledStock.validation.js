/**
 * =============================================================================
 * SPOILED STOCK VALIDATION: Zod schemas for spoilage operations
 * =============================================================================
 * Validates input for recording, updating, and querying spoilage records
 *
 * @module validations/spoiledStock.validation
 */

import { z } from 'zod';

/**
 * SPOILAGE TYPE ENUM
 * Standard categories for spoilage incidents
 */
const SPOILAGE_TYPES = [
  'expiration',
  'damage',
  'storage',
  'handling',
  'theft',
  'other',
];

/**
 * RECORD SPOILAGE SCHEMA
 * Validates request to record a spoilage incident
 */
export const recordSpoilageSchema = z.object({
  businessId: z.coerce.number().int().positive('Business ID must be positive'),
  productId: z.coerce.number().int().positive('Product ID must be positive'),
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than 0')
    .max(999999999, 'Quantity too large'),
  spoilageType: z
    .enum(SPOILAGE_TYPES)
    .describe(
      'Type of spoilage: expiration, damage, storage, handling, theft, other'
    ),
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason must not exceed 500 characters')
    .describe(
      'Detailed reason for spoilage (e.g., "Dropped during unloading", "Exposed to moisture")'
    ),
  notes: z
    .string()
    .max(1000, 'Notes must not exceed 1000 characters')
    .optional()
    .describe('Additional context or observations'),
  referenceType: z
    .enum(['stock_count', 'delivery_check', 'manual'])
    .optional()
    .describe('Source of spoilage discovery'),
  referenceId: z
    .coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Reference ID for related operation (e.g., stock_count_id)'),
});

/**
 * LIST SPOILAGE SCHEMA
 * Validates query parameters for listing spoilage records
 */
export const listSpoilageSchema = z.object({
  businessId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().optional(),
  spoilageType: z.enum(SPOILAGE_TYPES).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit must not exceed 100')
    .default(50),
  offset: z.coerce.number().int().min(0, 'Offset must be non-negative').default(0),
});

/**
 * UPDATE SPOILAGE SCHEMA
 * Validates updates to a spoilage record
 * All fields are optional (partial update)
 */
export const updateSpoilageSchema = z.object({
  spoilageType: z.enum(SPOILAGE_TYPES).optional(),
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason must not exceed 500 characters')
    .optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * GET SPOILAGE ANALYTICS SCHEMA
 * Validates request for spoilage analytics
 */
export const getSpoilageAnalyticsSchema = z.object({
  businessId: z.coerce.number().int().positive(),
  analysisType: z
    .enum([
      'summary',
      'by_type',
      'monthly_trend',
      'top_spoiled',
      'highest_loss',
      'spoilage_rate',
    ])
    .default('summary')
    .describe(
      'Type of analysis: summary, by_type, monthly_trend, top_spoiled, highest_loss, spoilage_rate'
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe('Number of items to return for list-based analyses'),
});

/**
 * DELETE SPOILAGE SCHEMA
 * Validates spoilage record deletion
 */
export const deleteSpoilageSchema = z.object({
  businessId: z.coerce.number().int().positive(),
  spoilageId: z.coerce.number().int().positive(),
});
