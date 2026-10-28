import { z } from 'zod';

export const paymentMethodEnum = z.enum(['till_number', 'paybill', 'wallet']);

// 'main' creates a new top-level business. 'branch' attaches to the main
// identified by main_business_code. The code is only looked up in the service.
export const branchTypeEnum = z.enum(['main', 'branch']);

// Format only. The service decides whether the code exists, and it answers
// with the same error either way.
export const businessCodePattern = /^[A-Za-z0-9-]{3,32}$/;

// Fields the server assigns. Clients never send them. Create rejects them and
// update strips them.
export const SERVER_MANAGED_KEYS = Object.freeze([
  'business_code',
  'is_main',
  'parent_business_id',
  'branch_sequence',
  'branch_status',
]);

export const createBusinessSchema = z
  .object({
    name: z.string().min(2).max(255).trim(),
    location: z.string().min(2).max(255).trim(),
    location_description: z.string().max(512).trim().optional(),
    logo_url: z.string().url('logo_url must be a valid URL').max(1024).optional(),
    payment_method: paymentMethodEnum,
    payment_identifier: z.string().min(3).max(50).trim(),
    branch_type: branchTypeEnum.default('main'),
    main_business_code: z
      .string()
      .trim()
      .regex(businessCodePattern, 'main_business_code is not a valid code')
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.branch_type === 'branch' && !data.main_business_code) {
      ctx.addIssue({
        code: 'custom',
        message: 'main_business_code is required for a branch',
        path: ['main_business_code'],
      });
    }
    if (data.branch_type === 'main' && data.main_business_code) {
      ctx.addIssue({
        code: 'custom',
        message: 'main_business_code is only valid when branch_type is branch',
        path: ['main_business_code'],
      });
    }
  });

// business_code, is_main, parent_business_id, branch_sequence and
// branch_status are deliberately absent. zod strips unknown keys, so they can
// never be written through this schema.
export const updateBusinessSchema = z.object({
  name: z.string().min(2).max(255).trim().optional(),
  location: z.string().min(2).max(255).trim().optional(),
  location_description: z.string().max(512).trim().optional(),
  logo_url: z.string().url('logo_url must be a valid URL').max(1024).optional(),
  payment_method: paymentMethodEnum.optional(),
  payment_identifier: z.string().min(3).max(50).trim().optional(),
});

export const branchApprovalSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'otp must be 6 digits'),
});

// Extra runtime check for payment_identifier based on payment_method,
// to be used in the controller or service.
export const validatePaymentDetails = ({
  payment_method,
  payment_identifier,
}) => {
  if (!payment_method || !payment_identifier) return;

  if (payment_method === 'till_number' || payment_method === 'paybill') {
    if (!/^[0-9]+$/.test(payment_identifier)) {
      throw new Error('Payment identifier must be numeric for till or paybill');
    }
  }

  if (payment_method === 'wallet') {
    // Wallet uses fixed till number 3485049 and account reference Onlinebuygoods, no validation needed
    return;
  }
};
