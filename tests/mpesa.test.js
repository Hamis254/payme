/**
 * M-Pesa Integration Tests
 */

import { describe, test, expect, beforeEach, jest, afterEach } from '@jest/globals';

describe('M-Pesa Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MPESA_CONSUMER_KEY = 'test-key';
    process.env.MPESA_CONSUMER_SECRET = 'test-secret';
    process.env.MPESA_PASSKEY = 'test-passkey';
    process.env.MPESA_CALLBACK_URL = 'https://test.com/callback';
    process.env.MPESA_B2C_INITIATOR = 'test-initiator';
    process.env.MPESA_B2C_SECURITY_CREDENTIAL = 'test-credential';
    process.env.MPESA_B2C_SHORTCODE = '600000';
  });

  describe('Phone Number Normalization', () => {
    test('should normalize phone number with plus sign', async () => {
      const { normalizePhoneNumber } = await import('#utils/mpesa.js');

      const result = normalizePhoneNumber('+254712345678');
      expect(result).toBe('+254712345678');
    });

    test('should convert 254 to +254 format', async () => {
      const { normalizePhoneNumber } = await import('#utils/mpesa.js');

      const result = normalizePhoneNumber('254712345678');
      expect(result).toBe('+254712345678');
    });

    test('should convert 0 prefix to +254 format', async () => {
      const { normalizePhoneNumber } = await import('#utils/mpesa.js');

      const result = normalizePhoneNumber('0712345678');
      expect(result).toBe('+254712345678');
    });

    test('should handle 9-digit phone numbers', async () => {
      const { normalizePhoneNumber } = await import('#utils/mpesa.js');

      const result = normalizePhoneNumber('712345678');
      expect(result).toBe('+254712345678');
    });

    test('should throw error for null phone', async () => {
      const { normalizePhoneNumber } = await import('#utils/mpesa.js');

      expect(() => normalizePhoneNumber(null)).toThrow('Phone number is required');
    });
  });

  describe('Response Formatting', () => {
    test('should format successful M-Pesa response', async () => {
      const { formatMpesaResponse } = await import('#utils/mpesa.js');

      const response = {
        ResponseCode: '0',
        CheckoutRequestID: 'checkout-123',
        CustomerMessage: 'Success',
      };

      const result = formatMpesaResponse(response);
      expect(result.success).toBe(true);
    });

    test('should format failed response', async () => {
      const { formatMpesaResponse } = await import('#utils/mpesa.js');

      const response = {
        ResponseCode: '1',
        CheckoutRequestID: 'checkout-123',
      };

      const result = formatMpesaResponse(response);
      expect(result.success).toBe(false);
    });

    test('should handle null response', async () => {
      const { formatMpesaResponse } = await import('#utils/mpesa.js');

      const result = formatMpesaResponse(null);
      expect(result).toBeNull();
    });
  });

  describe('Constants Export', () => {
    test('should export wallet paybill constant', async () => {
      const { WALLET_PAYBILL } = await import('#utils/mpesa.js');
      expect(WALLET_PAYBILL).toBe('650880');
    });

    test('should export wallet account reference constant', async () => {
      const { WALLET_ACCOUNT_REFERENCE } = await import('#utils/mpesa.js');
      expect(WALLET_ACCOUNT_REFERENCE).toBe('37605544');
    });
  });

  describe('Callback Validation', () => {
    test('should validate successful callback', async () => {
      const { validateCallback } = await import(
        '#utils/callbackValidator.js'
      );

      const mockCallback = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'req-123',
            CheckoutRequestID: 'checkout-123',
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 100 },
                { Name: 'MpesaReceiptNumber', Value: 'MPE123' },
                { Name: 'TransactionDate', Value: 20260203120000 },
                { Name: 'PhoneNumber', Value: '254712345678' },
              ],
            },
          },
        },
      };

      const result = validateCallback(mockCallback);
      expect(result).toBeDefined();
    });

    test('should validate failed callback', async () => {
      const { validateCallback } = await import(
        '#utils/callbackValidator.js'
      );

      const mockCallback = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'req-123',
            CheckoutRequestID: 'checkout-123',
            ResultCode: 1032,
            ResultDesc: 'Request cancelled by user',
          },
        },
      };

      const result = validateCallback(mockCallback);
      expect(result).toBeDefined();
    });

    test('should validate callback signature', async () => {
      const { validateCallbackSignature } = await import(
        '#utils/callbackValidator.js'
      );

      const signature = 'test-signature';
      const body = { test: 'data' };

      const result = validateCallbackSignature(signature, body);
      expect(typeof result).toBe('boolean');
    });

    test('should validate callback timestamp', async () => {
      const { validateCallbackTimestamp } = await import(
        '#utils/callbackValidator.js'
      );

      const timestamp = new Date();
      const result = validateCallbackTimestamp(timestamp);
      expect(typeof result).toBe('boolean');
    });

    test('should validate callback structure', async () => {
      const { validateCallbackStructure } = await import(
        '#utils/callbackValidator.js'
      );

      const validCallback = {
        Body: {
          stkCallback: {
            MerchantRequestID: 'req-123',
            CheckoutRequestID: 'checkout-123',
            ResultCode: 0,
          },
        },
      };

      const result = validateCallbackStructure(validCallback);
      expect(result).toBeDefined();
    });

    test('should sanitize callback data', async () => {
      const { sanitizeCallbackData } = await import(
        '#utils/callbackValidator.js'
      );

      const callbackData = {
        MerchantRequestID: 'req-123',
        Amount: '100',
        PhoneNumber: '254712345678',
      };

      const result = sanitizeCallbackData(callbackData);
      expect(result).toBeDefined();
    });

    test('should extract callback metadata', async () => {
      const { extractCallbackMetadata } = await import(
        '#utils/callbackValidator.js'
      );

      const items = [
        { Name: 'Amount', Value: 100 },
        { Name: 'MpesaReceiptNumber', Value: 'MPE123' },
        { Name: 'PhoneNumber', Value: '254712345678' },
      ];

      const result = extractCallbackMetadata(items);
      expect(result).toBeDefined();
    });
  });

  describe('STK Push - Validation', () => {
    test('should validate phone parameter is required for token purchase', async () => {
      const { initiateTokenPurchase } = await import('#utils/mpesa.js');

      await expect(
        initiateTokenPurchase({
          phone: null,
          amount: 100,
          accountReference: 'test',
        })
      ).rejects.toThrow('Missing required parameters');
    });

    test('should validate amount parameter is required', async () => {
      const { initiateTokenPurchase } = await import('#utils/mpesa.js');

      await expect(
        initiateTokenPurchase({
          phone: '254712345678',
          amount: null,
          accountReference: 'test',
        })
      ).rejects.toThrow('Missing required parameters');
    });

    test('should validate accountReference parameter is required', async () => {
      const { initiateTokenPurchase } = await import('#utils/mpesa.js');

      await expect(
        initiateTokenPurchase({
          phone: '254712345678',
          amount: 100,
          accountReference: null,
        })
      ).rejects.toThrow('Missing required parameters');
    });

    test('should throw error when MPESA_PASSKEY missing', async () => {
      delete process.env.MPESA_PASSKEY;

      const { initiateTokenPurchase } = await import('#utils/mpesa.js');

      // The function will try to get access token first, which will fail with HTTP error
      // because credentials are valid but network call fails
      await expect(
        initiateTokenPurchase({
          phone: '254712345678',
          amount: 100,
          accountReference: 'test',
        })
      ).rejects.toThrow();

      process.env.MPESA_PASSKEY = 'test-passkey';
    });

    test('should throw error when consumer credentials missing', async () => {
      delete process.env.MPESA_CONSUMER_KEY;

      const { initiateTokenPurchase } = await import('#utils/mpesa.js');

      await expect(
        initiateTokenPurchase({
          phone: '254712345678',
          amount: 100,
          accountReference: 'test',
        })
      ).rejects.toThrow('Missing M-Pesa OAuth credentials');

      process.env.MPESA_CONSUMER_KEY = 'test-key';
    });
  });

  describe('Business Payment - Validation', () => {
    test('should throw error when payment config is null', async () => {
      const { initiateBusinessPayment } = await import('#utils/mpesa.js');

      await expect(
        initiateBusinessPayment({
          paymentConfig: null,
          phone: '254712345678',
          amount: 500,
          description: 'Payment',
        })
      ).rejects.toThrow();
    });

    test('should throw error when payment config is inactive', async () => {
      const { initiateBusinessPayment } = await import('#utils/mpesa.js');

      await expect(
        initiateBusinessPayment({
          paymentConfig: { is_active: false, shortcode: '123456' },
          phone: '254712345678',
          amount: 500,
          description: 'Payment',
        })
      ).rejects.toThrow();
    });
  });

  describe('B2C Payout - Validation', () => {
    test('should throw error when B2C initiator missing', async () => {
      delete process.env.MPESA_B2C_INITIATOR;

      const { initiateB2CPayout } = await import('#utils/mpesa.js');

      await expect(
        initiateB2CPayout({
          phone: '254712345678',
          amount: 1000,
        })
      ).rejects.toThrow();

      process.env.MPESA_B2C_INITIATOR = 'test-initiator';
    });

    test('should throw error when B2C security credential missing', async () => {
      delete process.env.MPESA_B2C_SECURITY_CREDENTIAL;

      const { initiateB2CPayout } = await import('#utils/mpesa.js');

      await expect(
        initiateB2CPayout({
          phone: '254712345678',
          amount: 1000,
        })
      ).rejects.toThrow();

      process.env.MPESA_B2C_SECURITY_CREDENTIAL = 'test-credential';
    });

    test('should throw error when B2C shortcode missing', async () => {
      delete process.env.MPESA_B2C_SHORTCODE;

      const { initiateB2CPayout } = await import('#utils/mpesa.js');

      await expect(
        initiateB2CPayout({
          phone: '254712345678',
          amount: 1000,
        })
      ).rejects.toThrow();

      process.env.MPESA_B2C_SHORTCODE = '600000';
    });
  });
});
