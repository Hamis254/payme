import axios from 'axios';
import logger from '#config/logger.js';

// ============================================================================
// M-PESA CONFIGURATION  (everything comes from .env — nothing hard-coded)
// ============================================================================
//
//   MPESA_ENV                  sandbox | production            (default sandbox)
//   MPESA_CONSUMER_KEY         Daraja app consumer key
//   MPESA_CONSUMER_SECRET      Daraja app consumer secret
//
//   --- Flow 1: token purchases (PayMe platform till) ---
//   MPESA_TILL_NUMBER          platform till           (PartyB)
//   MPESA_SHORTCODE            optional. BusinessShortCode. Defaults to
//                              MPESA_TILL_NUMBER. In production a Till's
//                              BusinessShortCode is its Store/HO number, so
//                              set this if yours differs from the till.
//   MPESA_PASSKEY              passkey that belongs to MPESA_SHORTCODE
//   MPESA_ACCOUNT_REFERENCE    optional, max 12 chars  (default PayMeTokens)
//   MPESA_TOKEN_CALLBACK_URL   public HTTPS URL of the TOKEN callback route
//
//   --- Flow 2: business customer payments ---
//   MPESA_SALES_CALLBACK_URL   public HTTPS URL of the SALES callback route
//   (shortcode / passkey / method come from the payment_configs table)
//
//   --- Sandbox helpers ---
//   MPESA_FORCE_TRANSACTION_TYPE  e.g. CustomerPayBillOnline. Honoured ONLY
//                                 when MPESA_ENV !== production. The Daraja
//                                 sandbox is built around paybill 174379.
//   MPESA_TEST_PHONE              254708374149
// ============================================================================

const isProduction = () => process.env.MPESA_ENV === 'production';

const getBaseUrl = () =>
  isProduction()
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// Kept for backwards compatibility with paymentConfig.service.js.
const MPESA_BASE_URL = getBaseUrl();

const requireEnv = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in environment`);
  return value;
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Daraja wants 2547XXXXXXXX / 2541XXXXXXXX — digits only, NO leading "+".
 * Accepts 07.., 01.., 7.., 1.., 254.., +254..
 */
export const toDarajaPhone = phone => {
  if (!phone) throw new Error('Phone number is required');
  const digits = String(phone).replace(/\D/g, '');

  let msisdn;
  if (/^254[17]\d{8}$/.test(digits)) msisdn = digits;
  else if (/^0[17]\d{8}$/.test(digits)) msisdn = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) msisdn = `254${digits}`;

  if (!msisdn) throw new Error('Invalid Kenyan phone number');
  return msisdn;
};

/**
 * Daraja timestamp: YYYYMMDDHHmmss, in East Africa Time (UTC+3, no DST).
 *
 * The old version did
 *   toISOString().replace(/[:-]/g, '').slice(0, 14)
 * which yields "20261029T12345" — it keeps the "T", drops the last second
 * digit, and is in UTC. Safaricom rejects that password/timestamp pair.
 */
export const darajaTimestamp = (now = new Date()) => {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/\D/g, '').slice(0, 14);
};

export const buildMpesaPassword = (shortcode, passkey, now = new Date()) => {
  const timestamp = darajaTimestamp(now);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
    'base64'
  );
  return { password, timestamp };
};

/** Turn an axios failure into an Error that carries Daraja's real reason. */
const toDarajaError = (err, context) => {
  const data = err.response?.data;
  const detail =
    data?.errorMessage ||
    data?.ResponseDescription ||
    data?.error_description ||
    data?.error ||
    data?.message ||
    err.message;
  const code = data?.errorCode || data?.ResponseCode || err.response?.status;
  const error = new Error(`${context}: ${code ? `${code} — ` : ''}${detail}`);
  error.daraja = data;
  error.status = err.response?.status;
  return error;
};

// ----------------------------------------------------------------------------
// OAuth (cached — Daraja tokens live ~1 hour)
// ----------------------------------------------------------------------------

let tokenCache = { token: null, expiresAt: 0, env: null };

const getAccessToken = async () => {
  const env = isProduction() ? 'production' : 'sandbox';
  if (
    tokenCache.token &&
    tokenCache.env === env &&
    Date.now() < tokenCache.expiresAt
  ) {
    return tokenCache.token;
  }

  const consumerKey = requireEnv('MPESA_CONSUMER_KEY');
  const consumerSecret = requireEnv('MPESA_CONSUMER_SECRET');
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    'base64'
  );

  try {
    const response = await axios.get(
      `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` }, timeout: 10000 }
    );
    const ttlMs = (Number(response.data.expires_in) || 3599) * 1000;
    tokenCache = {
      token: response.data.access_token,
      expiresAt: Date.now() + ttlMs - 60_000,
      env,
    };
    return tokenCache.token;
  } catch (err) {
    throw toDarajaError(err, 'M-Pesa OAuth failed (check key/secret vs MPESA_ENV)');
  }
};

// ----------------------------------------------------------------------------
// ONE STK push implementation, used by BOTH flows (and config verification)
// ----------------------------------------------------------------------------

export const sendStkPush = async ({
  label,
  shortcode, // BusinessShortCode
  partyB, // receiving till / paybill
  passkey,
  transactionType,
  amount,
  phone,
  accountReference,
  description,
  callbackUrl,
}) => {
  const msisdn = toDarajaPhone(phone);
  const amountInt = Math.round(Number(amount));
  if (!Number.isFinite(amountInt) || amountInt < 1) {
    throw new Error('Amount must be at least KES 1');
  }
  if (!callbackUrl || !/^https:\/\//i.test(callbackUrl)) {
    throw new Error('Callback URL must be a public HTTPS URL');
  }

  const effectiveType =
    !isProduction() && process.env.MPESA_FORCE_TRANSACTION_TYPE
      ? process.env.MPESA_FORCE_TRANSACTION_TYPE
      : transactionType;

  const accessToken = await getAccessToken();
  const { password, timestamp } = buildMpesaPassword(shortcode, passkey);

  const payload = {
    BusinessShortCode: String(shortcode),
    Password: password,
    Timestamp: timestamp,
    TransactionType: effectiveType,
    Amount: amountInt,
    PartyA: msisdn,
    PartyB: String(partyB),
    PhoneNumber: msisdn,
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference).substring(0, 12),
    TransactionDesc: String(description).substring(0, 13),
  };

  logger.info(`STK push (${label})`, {
    env: isProduction() ? 'production' : 'sandbox',
    shortcode: payload.BusinessShortCode,
    partyB: payload.PartyB,
    transactionType: payload.TransactionType,
    amount: amountInt,
    callbackUrl,
    // never log Password / passkey / full phone
    phoneTail: msisdn.slice(-4),
  });

  let response;
  try {
    response = await axios.post(
      `${getBaseUrl()}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    const error = toDarajaError(err, `STK push (${label}) rejected`);
    logger.error(`STK push (${label}) failed`, {
      status: error.status,
      daraja: error.daraja,
    });
    throw error;
  }

  const {
    ResponseCode,
    ResponseDescription,
    CheckoutRequestID,
    MerchantRequestID,
    CustomerMessage,
  } = response.data;

  if (String(ResponseCode) !== '0') {
    throw new Error(
      `M-Pesa error: ${ResponseCode} — ${ResponseDescription || CustomerMessage}`
    );
  }

  logger.info(`STK push (${label}) accepted`, {
    checkoutRequestId: CheckoutRequestID,
  });

  return {
    success: true,
    CheckoutRequestID,
    MerchantRequestID,
    ResponseCode,
    ResponseDescription,
    CustomerMessage,
  };
};

// ----------------------------------------------------------------------------
// Platform till config — read lazily so dotenv load order can't bite us
// ----------------------------------------------------------------------------

export const getPlatformTill = () => {
  const tillNumber = requireEnv('MPESA_TILL_NUMBER');
  return {
    tillNumber,
    shortcode: process.env.MPESA_SHORTCODE || tillNumber,
    passkey: requireEnv('MPESA_PASSKEY'),
    accountReference: process.env.MPESA_ACCOUNT_REFERENCE || 'PayMeTokens',
    callbackUrl: requireEnv('MPESA_TOKEN_CALLBACK_URL'),
  };
};

// ============================================================================
// FLOW 1 — TOKEN PURCHASES (PayMe platform till, from .env)
// ============================================================================

export const initiateTokenPurchase = async ({
  phone,
  amount,
  accountReference, // e.g. TOKEN-123 — goes in TransactionDesc
}) => {
  if (!phone || !amount || !accountReference) {
    throw new Error(
      'Missing required parameters: phone, amount, accountReference'
    );
  }
  const till = getPlatformTill();

  return sendStkPush({
    label: 'token-purchase',
    shortcode: till.shortcode,
    partyB: till.tillNumber,
    passkey: till.passkey,
    transactionType: 'CustomerBuyGoodsOnline',
    amount,
    phone,
    accountReference: till.accountReference,
    description: accountReference,
    callbackUrl: till.callbackUrl,
  });
};

// ============================================================================
// FLOW 2 — BUSINESS CUSTOMER PAYMENTS (till/paybill saved by the merchant)
// ============================================================================

export const initiateBusinessPayment = async ({
  paymentConfig,
  phone,
  amount,
  description,
}) => {
  if (!phone || !amount || !description) {
    throw new Error('Missing required parameters: phone, amount, description');
  }
  if (!paymentConfig) {
    throw new Error(
      'Business payment configuration is required. Please set up your M-Pesa credentials in Settings.'
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

  const isTill = paymentConfig.payment_method === 'till_number';
  const accountReference = isTill
    ? paymentConfig.account_reference || paymentConfig.shortcode
    : paymentConfig.account_reference;

  if (!isTill && !accountReference) {
    throw new Error(
      'Account reference is required for paybill payments. Please update your payment configuration.'
    );
  }

  return sendStkPush({
    label: 'business-payment',
    shortcode: paymentConfig.shortcode,
    partyB: paymentConfig.shortcode,
    passkey: paymentConfig.passkey,
    transactionType: isTill ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    amount,
    phone,
    accountReference,
    description,
    callbackUrl: requireEnv('MPESA_SALES_CALLBACK_URL'),
  });
};

// ============================================================================
// B2C PAYOUT (unchanged apart from shared helpers)
// ============================================================================

export const initiateB2CPayout = async ({
  phone,
  amount,
  remarks = 'PAYME Payout',
}) => {
  if (!phone || !amount) {
    throw new Error('Missing required parameters: phone, amount');
  }

  const initiator = process.env.MPESA_B2C_INITIATOR;
  const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
  const partyA = process.env.MPESA_B2C_SHORTCODE;

  if (!initiator || !securityCredential || !partyA) {
    throw new Error(
      'Missing B2C configuration (MPESA_B2C_INITIATOR, MPESA_B2C_SECURITY_CREDENTIAL, or MPESA_B2C_SHORTCODE)'
    );
  }

  const accessToken = await getAccessToken();
  const payload = {
    InitiatorName: initiator,
    SecurityCredential: securityCredential,
    CommandID: 'BusinessPayment',
    Amount: Math.round(amount),
    PartyA: partyA,
    PartyB: toDarajaPhone(phone),
    Remarks: remarks,
    QueueTimeOutURL: process.env.MPESA_B2C_TIMEOUT_URL,
    ResultURL: process.env.MPESA_B2C_RESULT_URL,
  };

  try {
    const response = await axios.post(
      `${getBaseUrl()}/mpesa/b2c/v3/paymentrequest`,
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
    if (ResponseCode !== '0') {
      throw new Error(`M-Pesa B2C error: ${ResponseCode} — ${ResponseDescription}`);
    }
    logger.info('B2C payout initiated', { conversationId: ConversationID });
    return { success: true, ConversationID, ResponseCode, ResponseDescription };
  } catch (e) {
    const error = e.response ? toDarajaError(e, 'B2C payout rejected') : e;
    logger.error('B2C payout failed', { error: error.message });
    throw error;
  }
};

// ============================================================================
// UTILITIES
// ============================================================================

/** E.164 (+254...) — for storage/display only. Use toDarajaPhone for Daraja. */
export const normalizePhoneNumber = phone => `+${toDarajaPhone(phone)}`;

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

export { MPESA_BASE_URL, getAccessToken };