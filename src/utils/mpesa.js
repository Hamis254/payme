import axios from 'axios';
import logger from '#config/logger.js';
import base64 from 'base-64';

// ============================================================================
// M-PESA CONFIGURATION
// ============================================================================
//
// SHARED SANDBOX APP (One app, multiple shortcodes):
// - MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET: OAuth credentials (shared)
// - Wallet Paybill: 650880 (for token purchases - hardcoded)
// - Business Paybill/Till: Configured per business in payment_configs table
//
// PASSKEYS:
// Each shortcode (paybill/till) has its own passkey in Daraja portal:
// - MPESA_PASSKEY: Passkey for the wallet paybill (650880)
// - Per-business passkey: Stored in payment_configs.passkey column
//
// ACCOUNT REFERENCES:
// - Wallet: 37605544 (fixed account for all token purchases)
// - Business: account_reference from payment_configs (max 12 chars)
// ============================================================================

// Fixed wallet paybill for token purchases
const WALLET_PAYBILL = '650880';
const WALLET_ACCOUNT_REFERENCE = '37605544';

// Get M-Pesa access token (shared across all operations)
const getAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('Missing M-Pesa OAuth credentials (CONSUMER_KEY/CONSUMER_SECRET)');
  }

  const auth = base64.encode(`${consumerKey}:${consumerSecret}`);

  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    {
      headers: { Authorization: `Basic ${auth}` },
    }
  );

  return response.data.access_token;
};

// Build STK Push password from shortcode, passkey, and timestamp
const buildMpesaPassword = (shortcode, passkey) => {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:-]/g, '')
    .slice(0, 14);
  const password = base64.encode(`${shortcode}${passkey}${timestamp}`);
  return { password, timestamp };
};

// ============================================================================
// INITIATE STK PUSH - TOKEN PURCHASES (WALLET)
// ============================================================================
// Uses FIXED wallet paybill: 650880, account: 37605544
// All token purchases go to the platform's wallet paybill
export const initiateTokenPurchase = async ({ phone, amount, accountReference }) => {
  try {
    if (!phone || !amount || !accountReference) {
      throw new Error('Missing required parameters: phone, amount, accountReference');
    }

    const accessToken = await getAccessToken();
    const passKey = process.env.MPESA_PASSKEY;

    if (!passKey) {
      throw new Error('Missing MPESA_PASSKEY environment variable');
    }

    const { password, timestamp } = buildMpesaPassword(WALLET_PAYBILL, passKey);

    const payload = {
      BusinessShortCode: WALLET_PAYBILL,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: WALLET_PAYBILL,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: WALLET_ACCOUNT_REFERENCE,
      TransactionDesc: accountReference,
    };

    logger.info('Initiating token purchase STK push', {
      paybill: WALLET_PAYBILL,
      account: WALLET_ACCOUNT_REFERENCE,
      amount,
    });

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { ResponseCode, ResponseDescription, CheckoutRequestID, CustomerMessage } = response.data;

    if (ResponseCode === '0') {
      logger.info('Token purchase STK push initiated', { checkoutRequestId: CheckoutRequestID });
      return { success: true, CheckoutRequestID, ResponseCode, ResponseDescription, CustomerMessage };
    } else {
      throw new Error(`M-Pesa error: ${ResponseCode} - ${ResponseDescription || CustomerMessage}`);
    }
  } catch (e) {
    logger.error('Token purchase STK push failed', { error: e.message });
    throw e;
  }
};

// ============================================================================
// INITIATE STK PUSH - CUSTOMER PAYMENTS (PER-BUSINESS)
// ============================================================================
// Uses business's own paybill/till from payment_configs table
// NO FALLBACK: Requires valid payment config to exist
export const initiateBusinessPayment = async ({ paymentConfig, phone, amount, description }) => {
  try {
    if (!phone || !amount || !description) {
      throw new Error('Missing required parameters: phone, amount, description');
    }

    // STRICT: No fallback to wallet paybill allowed
    if (!paymentConfig) {
      throw new Error(
        'Business payment configuration is required. ' +
        'Please setup your M-Pesa credentials first.'
      );
    }

    if (!paymentConfig.is_active) {
      throw new Error('Payment configuration is inactive. Please activate in settings.');
    }

    if (!paymentConfig.shortcode || !paymentConfig.passkey || !paymentConfig.account_reference) {
      throw new Error('Payment configuration is incomplete. Please reconfigure.');
    }

    const accessToken = await getAccessToken();

    // Use business's paybill/till directly (NO FALLBACK)
    const businessShortCode = paymentConfig.shortcode;
    const passKey = paymentConfig.passkey;
    const accountRef = paymentConfig.account_reference;

    const { password, timestamp } = buildMpesaPassword(businessShortCode, passKey);

    const payload = {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: paymentConfig?.payment_method === 'till_number' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: businessShortCode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: description,
    };

    logger.info('Initiating business payment STK push', {
      shortcode: businessShortCode,
      paymentMethod: paymentConfig.payment_method,
      amount,
      configVerified: paymentConfig.verified,
    });

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { ResponseCode, ResponseDescription, CheckoutRequestID, CustomerMessage } = response.data;

    if (ResponseCode === '0') {
      logger.info('Business payment STK push initiated', { checkoutRequestId: CheckoutRequestID });
      return { success: true, CheckoutRequestID, ResponseCode, ResponseDescription, CustomerMessage };
    } else {
      throw new Error(`M-Pesa error: ${ResponseCode} - ${ResponseDescription || CustomerMessage}`);
    }
  } catch (e) {
    logger.error('Business payment STK push failed', { error: e.message });
    throw e;
  }
};

// ============================================================================
// INITIATE B2C PAYOUT (Business to Customer)
// ============================================================================
// Used for wallet withdrawals or refunds to customer phone
export const initiateB2CPayout = async ({ phone, amount, remarks = 'PAYME Payout' }) => {
  try {
    if (!phone || !amount) {
      throw new Error('Missing required parameters: phone, amount');
    }

    const accessToken = await getAccessToken();

    const initiator = process.env.MPESA_B2C_INITIATOR;
    const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
    const partyA = process.env.MPESA_B2C_SHORTCODE;

    if (!initiator || !securityCredential || !partyA) {
      throw new Error('Missing B2C configuration (initiator, security_credential, or shortcode)');
    }

    const payload = {
      InitiatorName: initiator,
      SecurityCredential: securityCredential,
      CommandID: 'BusinessPayment',
      Amount: Math.round(amount),
      PartyA: partyA,
      PartyB: phone,
      Remarks: remarks,
      QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
      ResultURL: process.env.MPESA_B2C_RESULT_URL,
    };

    logger.info('Initiating B2C payout', { phone, amount, partyA });

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/b2c/v3/paymentrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { ResponseCode, ResponseDescription, ConversationID } = response.data;

    if (ResponseCode === '0') {
      logger.info('B2C payout initiated', { conversationId: ConversationID });
      return { success: true, ConversationID, ResponseCode, ResponseDescription };
    } else {
      throw new Error(`M-Pesa B2C error: ${ResponseCode} - ${ResponseDescription}`);
    }
  } catch (e) {
    logger.error('B2C payout failed', { error: e.message });
    throw e;
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Validate and normalize phone number to E.164 format
export const normalizePhoneNumber = (phone) => {
  if (!phone) throw new Error('Phone number is required');

  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+254')) return cleaned;
  if (cleaned.startsWith('254')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+254${cleaned.slice(1)}`;
  if (cleaned.length === 9) return `+254${cleaned}`;

  throw new Error('Invalid phone number format');
};

// Format M-Pesa response consistently
export const formatMpesaResponse = (response) => {
  if (!response) return null;
  return {
    success: response.ResponseCode === '0',
    checkoutRequestId: response.CheckoutRequestID,
    responseCode: response.ResponseCode,
    responseDescription: response.ResponseDescription,
    customerMessage: response.CustomerMessage,
    conversationId: response.ConversationID,
  };
};

// Export constants for reference
export { WALLET_PAYBILL, WALLET_ACCOUNT_REFERENCE };
