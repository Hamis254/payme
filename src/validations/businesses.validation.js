import { z } from 'zod';

const kenyaPhoneRegex = /^(\+?254|0)[17][0-9]{8}$/;

export const paymentMethodEnum = z.enum([
  'till_number',
  'paybill',
  'pochi_la_biashara',
  'send_money',
]);

export const createBusinessSchema = z.object({
  name: z.string().min(2).max(255).trim(),
  location: z.string().min(2).max(255).trim(),
  location_description: z.string().max(512).trim().optional(),
  payment_method: paymentMethodEnum,
  payment_identifier: z.string().min(3).max(50).trim(),
});

export const updateBusinessSchema = z.object({
  name: z.string().min(2).max(255).trim().optional(),
  location: z.string().min(2).max(255).trim().optional(),
  location_description: z.string().max(512).trim().optional(),
  payment_method: paymentMethodEnum.optional(),
  payment_identifier: z.string().min(3).max(50).trim().optional(),
});

// Extra runtime check for payment_identifier based on payment_method,
// to be used in the controller or service.
export const validatePaymentDetails = ({ payment_method, payment_identifier }) => {
  if (!payment_method || !payment_identifier) return;

  if (payment_method === 'till_number' || payment_method === 'paybill') {
    if (!/^[0-9]+$/.test(payment_identifier)) {
      throw new Error('Payment identifier must be numeric for till or paybill');
    }
  }

  if (payment_method === 'pochi_la_biashara' || payment_method === 'send_money') {
    if (!kenyaPhoneRegex.test(payment_identifier)) {
      throw new Error('Payment identifier must be a valid Kenyan phone number');
    }
  }
};
