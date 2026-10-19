import { z } from 'zod';

export const paymentMethodEnum = z.enum(['till_number', 'paybill', 'wallet']);

export const createBusinessSchema = z.object({
  name: z.string().min(2).max(255).trim(),
  location: z.string().min(2).max(255).trim(),
  location_description: z.string().max(512).trim().optional(),
  logo_url: z.string().url('logo_url must be a valid URL').max(1024).optional(),
  payment_method: paymentMethodEnum,
  payment_identifier: z.string().min(3).max(50).trim(),
});

export const updateBusinessSchema = z.object({
  name: z.string().min(2).max(255).trim().optional(),
  location: z.string().min(2).max(255).trim().optional(),
  location_description: z.string().max(512).trim().optional(),
  logo_url: z.string().url('logo_url must be a valid URL').max(1024).optional(),
  payment_method: paymentMethodEnum.optional(),
  payment_identifier: z.string().min(3).max(50).trim().optional(),
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