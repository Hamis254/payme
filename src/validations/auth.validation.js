import { z } from 'zod';

// Kenyan phone number validation: accepts +254XXXXXXXXX or 0XXXXXXXXX formats
const kenyaPhoneRegex = /^(\+?254|0)[17][0-9]{8}$/;

// Kenyan national ID numbers are numeric, typically 7–8 digits (older IDs
// can run shorter). Kept slightly wide (6–10 digits) to avoid rejecting
// valid older/newer ID formats.
const kenyaIdNumberRegex = /^\d{6,10}$/;

// 4-digit PIN, used as the account password.
// NOTE: this is intentionally short for ease of use by shop owners — the
// lockout logic in auth.service.js (5 failed attempts → 15 min lock) is
// what makes a PIN this short safe to use. Don't remove the lockout logic
// without also lengthening the PIN requirement.
const pinRegex = /^\d{4}$/;

export const signupSchema = z.object({
  name: z.string().min(2).max(255).trim(),
  id_number: z
    .string()
    .regex(kenyaIdNumberRegex, 'Invalid ID number. Must be 6-10 digits')
    .trim(),
  phone_number: z
    .string()
    .regex(
      kenyaPhoneRegex,
      'Invalid Kenyan phone number. Use +254XXXXXXXXX or 0XXXXXXXXX format'
    )
    .trim(),
  email: z.string().email('Invalid email address').trim().toLowerCase(),
  password: z.string().regex(pinRegex, 'Password must be exactly 4 digits'),
  role: z.enum(['user', 'admin']).default('user'),
});

export const signInSchema = z.object({
  name: z.string().min(2).max(255).trim(),
  password: z.string().regex(pinRegex, 'Password must be exactly 4 digits'),
});