import 'dotenv/config';
import { initiateTokenPurchase } from '#utils/mpesa.js';

const phone = process.argv[2] || process.env.MPESA_TEST_PHONE;

try {
  const result = await initiateTokenPurchase({
    phone,
    amount: 10,
    accountReference: 'TOKEN-TEST',
  });
  console.log(result);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
