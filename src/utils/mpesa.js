import axios from 'axios';
import logger from '#config/logger.js';
import base64 from 'base-64';

// ============================================================================
// M-PESA CONFIGURATION
// ============================================================================
//
// ENVIRONMENT SWITCH:
//   Set MPESA_ENV=production in .env to go live.
//   Default is sandbox.
//
// TWO PAYBILL ARCHITECTURE:
//   PayMe Platform Paybill (650880): Used for token purchases by merchants.
//     - MPESA_PASSKEY: passkey for paybill 650880
//
//   Business Paybill/Till: Set per-business in payment_configs table.
//     - Each business configures their own shortcode + passkey in Settings.
//     - Used when initiating STK push to a customer for a sale.
//
// ACCOUNT REFERENCES (shown on customer's phone):
//   Paybill: account_reference field (e.g. "SHOP001") — max 12 chars — REQUIRED
//   Till:    account_reference field (store name) — optional, defaults to till number
// ============================================================================

// Fixed PayMe platform paybill for token purchases
const WALLET_PAYBILL = '650880';
const WALLET_ACCOUNT_REFERENCE = '37605544';

// Switch between sandbox and production with one env variable
const MPESA_BASE_URL =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

/**
 * Get M-Pesa OAuth access token.
 * Shared across all STK push operations — uses the platform app credentials.
 */
const getAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      'Missing M-Pesa OAuth credentials (MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET)'
    );
  }

  const auth = base64.encode(`${consumerKey}:${consumerSecret}`);

  const response = await axios.get(
    `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000,
    }
  );

  return response.data.access_token;
};

/**
 * Build the STK Push password (base64 of shortcode + passkey + timestamp)
 * and the timestamp required by Safaricom.
 */
const buildMpesaPassword = (shortcode, passkey) => {
  const timestamp = new Date().toISOString().replace(/[:-]/g, '').slice(0, 14);
  const password = base64.encode(`${shortcode}${passkey}${timestamp}`);
  return { password, timestamp };
};

// ============================================================================
// STK PUSH — TOKEN PURCHASES (PayMe Platform Paybill)
// ============================================================================
// All merchants buy tokens by paying into PayMe's own paybill (650880).
// MPESA_PASSKEY must match the passkey for paybill 650880 in Daraja portal.
// ============================================================================

export const initiateTokenPurchase = async ({
  phone,
  amount,
  accountReference,
}) => {
  try {
    if (!phone || !amount || !accountReference) {
      throw new Error(
        'Missing required parameters: phone, amount, accountReference'
      );
    }

    const accessToken = await getAccessToken();
    const passKey = process.env.MPESA_PASSKEY;

    if (!passKey) {
      throw new Error(
        'Missing MPESA_PASSKEY environment variable (required for PayMe platform paybill)'
      );
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
      env: process.env.MPESA_ENV || 'sandbox',
      paybill: WALLET_PAYBILL,
      account: WALLET_ACCOUNT_REFERENCE,
      amount,
    });

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const {
      ResponseCode,
      ResponseDescription,
      CheckoutRequestID,
      CustomerMessage,
    } = response.data;

    if (ResponseCode === '0') {
      logger.info('Token purchase STK push initiated', {
        checkoutRequestId: CheckoutRequestID,
      });
      return {
        success: true,
        CheckoutRequestID,
        ResponseCode,
        ResponseDescription,
        CustomerMessage,
      };
    } else {
      throw new Error(
        `M-Pesa error: ${ResponseCode} — ${ResponseDescription || CustomerMessage}`
      );
    }
  } catch (e) {
    logger.error('Token purchase STK push failed', { error: e.message });
    throw e;
  }
};

// ============================================================================
// STK PUSH — CUSTOMER PAYMENTS (Per-Business Paybill or Till)
// ============================================================================
// Uses the business's own paybill or till from the payment_configs table.
// No fallback to platform paybill — config MUST be set up first.
//
// Till number:  TransactionType = CustomerBuyGoodsOnline
//               AccountReference = store name (optional, shown to customer)
//
// Paybill:      TransactionType = CustomerPayBillOnline
//               AccountReference = account number (REQUIRED, max 12 chars)
// ============================================================================

export const initiateBusinessPayment = async ({
  paymentConfig,
  phone,
  amount,
  description,
}) => {
  try {
    if (!phone || !amount || !description) {
      throw new Error(
        'Missing required parameters: phone, amount, description'
      );
    }

    if (!paymentConfig) {
      throw new Error(
        'Business payment configuration is required. ' +
          'Please set up your M-Pesa credentials in Settings.'
      );
    }

    if (!paymentConfig.is_active) {
      throw new Error(
        'Payment configuration is inactive. Please activate in Settings.'
      );
    }

    if (!paymentConfig.shortcode || !paymentConfig.passkey) {
      throw new Error(
        'Payment configuration is incomplete. Please reconfigure your M-Pesa credentials.'
      );
    }

    const accessToken = await getAccessToken();

    const businessShortCode = paymentConfig.shortcode;
    const passKey = paymentConfig.passkey;
    const isTill = paymentConfig.payment_method === 'till_number';

    // Paybill: account_reference is the account number — REQUIRED by Safaricom
    // Till:    account_reference is the store name — optional, defaults to till number
    const accountRef = isTill
      ? (paymentConfig.account_reference || businessShortCode).substring(0, 12)
      : paymentConfig.account_reference;

    if (!isTill && !accountRef) {
      throw new Error(
        'Account reference is required for paybill payments. ' +
          'Please update your payment configuration.'
      );
    }

    const { password, timestamp } = buildMpesaPassword(
      businessShortCode,
      passKey
    );

    const payload = {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: isTill
        ? 'CustomerBuyGoodsOnline'
        : 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: businessShortCode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: description.substring(0, 13), // Safaricom max is 13 chars
    };

    logger.info('Initiating business payment STK push', {
      env: process.env.MPESA_ENV || 'sandbox',
      shortcode: businessShortCode,
      paymentMethod: paymentConfig.payment_method,
      transactionType: payload.TransactionType,
      amount,
      configVerified: paymentConfig.verified,
    });

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const {
      ResponseCode,
      ResponseDescription,
      CheckoutRequestID,
      CustomerMessage,
    } = response.data;

    if (ResponseCode === '0') {
      logger.info('Business payment STK push initiated', {
        checkoutRequestId: CheckoutRequestID,
      });
      return {
        success: true,
        CheckoutRequestID,
        ResponseCode,
        ResponseDescription,
        CustomerMessage,
      };
    } else {
      throw new Error(
        `M-Pesa error: ${ResponseCode} — ${ResponseDescription || CustomerMessage}`
      );
    }
  } catch (e) {
    logger.error('Business payment STK push failed', { error: e.message });
    throw e;
  }
};

// ============================================================================
// B2C PAYOUT (Business to Customer)
// ============================================================================
// Used for wallet withdrawals or refunds to a customer's phone number.
// ============================================================================

export const initiateB2CPayout = async ({
  phone,
  amount,
  remarks = 'PAYME Payout',
}) => {
  try {
    if (!phone || !amount) {
      throw new Error('Missing required parameters: phone, amount');
    }

    const accessToken = await getAccessToken();

    const initiator = process.env.MPESA_B2C_INITIATOR;
    const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
    const partyA = process.env.MPESA_B2C_SHORTCODE;

    if (!initiator || !securityCredential || !partyA) {
      throw new Error(
        'Missing B2C configuration (MPESA_B2C_INITIATOR, MPESA_B2C_SECURITY_CREDENTIAL, or MPESA_B2C_SHORTCODE)'
      );
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

    logger.info('Initiating B2C payout', {
      env: process.env.MPESA_ENV || 'sandbox',
      phone,
      amount,
      partyA,
    });

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/b2c/v3/paymentrequest`,
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
      return {
        success: true,
        ConversationID,
        ResponseCode,
        ResponseDescription,
      };
    } else {
      throw new Error(
        `M-Pesa B2C error: ${ResponseCode} — ${ResponseDescription}`
      );
    }
  } catch (e) {
    logger.error('B2C payout failed', { error: e.message });
    throw e;
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalize a Kenyan phone number to E.164 format (+254...)
 */
export const normalizePhoneNumber = phone => {
  if (!phone) throw new Error('Phone number is required');

  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+254')) return cleaned;
  if (cleaned.startsWith('254')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+254${cleaned.slice(1)}`;
  if (cleaned.length === 9) return `+254${cleaned}`;

  throw new Error('Invalid phone number format');
};

/**
 * Format an M-Pesa API response into a consistent shape
 */
export const formatMpesaResponse = response => {
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

export { WALLET_PAYBILL, WALLET_ACCOUNT_REFERENCE };
