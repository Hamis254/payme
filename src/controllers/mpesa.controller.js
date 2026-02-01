import axios from 'axios';
import { timestamp } from '#utils/timestamp.js';
import logger from '#config/logger.js';

/**
 * Handle STK Push for Wallet Token Purchase
 * Routes token purchases to FIXED paybill 650880, account 37605544
 * Uses M-Pesa access token from generateToken middleware
 */
const handleStkPush = async (req, res) => {
  try {
    const { phone, amount, accountReference = 'TOKEN-PURCHASE' } = req.body;

    // ✅ HARDCODED WALLET PAYBILL
    const BUSINESS_SHORT_CODE = '650880';
    const ACCOUNT_REFERENCE = '37605544';
    const PASSKEY = process.env.MPESA_PASSKEY_WALLET;

    if (!PASSKEY) {
      logger.error('Missing MPESA_PASSKEY_WALLET in environment');
      return res.status(500).json({
        error: 'Configuration error: Wallet passkey not configured',
      });
    }

    if (!req.token) {
      logger.error('No access token provided from middleware');
      return res.status(401).json({
        error: 'Access token required - ensure generateToken middleware is applied',
      });
    }

    // Build password: Base64(ShortCode + PassKey + Timestamp)
    const password = Buffer.from(
      BUSINESS_SHORT_CODE + PASSKEY + timestamp
    ).toString('base64');

    const payload = {
      BusinessShortCode: BUSINESS_SHORT_CODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: BUSINESS_SHORT_CODE,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: ACCOUNT_REFERENCE,
      TransactionDesc: accountReference,
    };

    logger.debug('STK Push payload for wallet', {
      paybill: BUSINESS_SHORT_CODE,
      account: ACCOUNT_REFERENCE,
      amount,
      phone,
    });

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${req.token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const { ResponseCode, CheckoutRequestID, ResponseDescription } = response.data;

    if (ResponseCode === '0') {
      logger.info('STK Push initiated successfully', {
        checkoutRequestId: CheckoutRequestID,
        paybill: BUSINESS_SHORT_CODE,
        amount,
      });

      return res.status(201).json({
        success: true,
        checkoutRequestId: CheckoutRequestID,
        responseCode: ResponseCode,
        responseDescription: ResponseDescription,
        data: response.data,
      });
    }

    logger.warn('STK Push failed', {
      responseCode: ResponseCode,
      description: ResponseDescription,
    });

    return res.status(400).json({
      success: false,
      error: ResponseDescription,
      responseCode: ResponseCode,
    });
  } catch (error) {
    logger.error('Error in STK Push handler', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    res.status(500).json({
      error: 'Failed to initiate payment',
      message: error.message,
    });
  }
};

export { handleStkPush };