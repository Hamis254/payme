import { z } from 'zod';

// Kenyan phone number validation: accepts +254XXXXXXXXX or 0XXXXXXXXX formats
const kenyaPhoneRegex = /^(\+?254|0)[17][0-9]{8}$/;

export const signupSchema = z.object({
  name: z.string().min(2).max(255).trim(),
  phone_number: z
    .string()
    .regex(
      kenyaPhoneRegex,
      'Invalid Kenyan phone number. Use +254XXXXXXXXX or 0XXXXXXXXX format'
    )
    .trim(),
  email: z.email().max(255).toLowerCase().trim(),
  password: z.string().min(6).max(128),
  role: z.enum(['user', 'admin']).default('user'),
});

export const signInSchema = z.object({
  email: z.email().toLowerCase().trim(),
  password: z.string().min(1),
});
