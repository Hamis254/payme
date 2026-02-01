import { z } from 'zod';

/**
 * createCustomerSchema
 * Validation for creating a new customer
 */
export const createCustomerSchema = z.object({
  name: z
    .string()
    .min(1, 'Customer name is required')
    .max(255, 'Name must be less than 255 characters'),

  phone: z
    .string()
    .min(1, 'Phone number is required')
    .max(20, 'Phone must be less than 20 characters')
    .optional()
    .nullable(),

  email: z
    .string()
    .email('Invalid email format')
    .optional()
    .nullable(),

  address: z
    .string()
    .max(500, 'Address must be less than 500 characters')
    .optional()
    .nullable(),

  customer_type: z
    .enum(['walk_in', 'regular', 'vip', 'wholesale'])
    .default('walk_in'),

  prefer_sms: z.boolean().default(true),
  prefer_email: z.boolean().default(false),
  prefer_call: z.boolean().default(false),
});

/**
 * updateCustomerSchema
 * Validation for updating customer info
 */
export const updateCustomerSchema = z.object({
  name: z
    .string()
    .min(1, 'Name cannot be empty')
    .max(255, 'Name must be less than 255 characters')
    .optional(),

  phone: z
    .string()
    .max(20, 'Phone must be less than 20 characters')
    .optional()
    .nullable(),

  email: z
    .string()
    .email('Invalid email format')
    .optional()
    .nullable(),

  address: z
    .string()
    .max(500, 'Address must be less than 500 characters')
    .optional()
    .nullable(),

  customer_type: z
    .enum(['walk_in', 'regular', 'vip', 'wholesale'])
    .optional(),

  prefer_sms: z.boolean().optional(),
  prefer_email: z.boolean().optional(),
  prefer_call: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

/**
 * customerNoteSchema
 * Validation for adding customer notes
 */
export const customerNoteSchema = z.object({
  note_type: z
    .enum(['personal', 'preference', 'issue', 'feedback'])
    .default('personal'),

  content: z
    .string()
    .min(1, 'Note content is required')
    .max(2000, 'Note must be less than 2000 characters'),
});

/**
 * updatePreferencesSchema
 * Validation for updating customer preferences
 */
export const updatePreferencesSchema = z.object({
  favorite_products: z
    .string()
    .transform(str => {
      try {
        return JSON.stringify(JSON.parse(str));
      } catch {
        return str;
      }
    })
    .optional(),

  preferred_payment: z
    .enum(['cash', 'mpesa', 'credit'])
    .optional(),

  best_contact_time: z
    .string()
    .max(100, 'Best contact time must be less than 100 characters')
    .optional()
    .nullable(),

  do_not_contact: z.boolean().optional(),
  can_receive_offers: z.boolean().optional(),
  can_receive_loyalty: z.boolean().optional(),
});

/**
 * customerListSchema
 * Validation for list/filter query parameters
 */
export const customerListSchema = z.object({
  limit: z
    .string()
    .transform(v => parseInt(v))
    .pipe(z.number().min(1).max(100))
    .optional(),

  offset: z
    .string()
    .transform(v => parseInt(v))
    .pipe(z.number().min(0))
    .optional(),

  sort_by: z
    .enum(['created_at', 'name', 'id'])
    .default('created_at')
    .optional(),

  sort_order: z
    .enum(['asc', 'desc'])
    .default('desc')
    .optional(),

  filter_type: z
    .enum(['walk_in', 'regular', 'vip', 'wholesale'])
    .optional()
    .nullable(),

  is_active: z
    .string()
    .transform(v => v !== 'false')
    .optional(),
});
