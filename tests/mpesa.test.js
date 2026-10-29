jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('#config/arcjet.js', () => ({
  __esModule: true,
  default: {
    withRule: jest.fn(),
  },
}));

jest.mock('@arcjet/node', () => ({
  slidingWindow: jest.fn(() => ({})),
}));

jest.mock('#services/myWallet.service.js', () => ({
  __esModule: true,
  getOrCreateWallet: jest.fn(),
  initiateTokenPurchase: jest.fn(),
  processTokenPurchaseCallback: jest.fn(),
  addTokensManually: jest.fn(),
  getWalletBalance: jest.fn(),
  getWalletTransactions: jest.fn(),
  getTokenPurchaseHistory: jest.fn(),
}));

import axios from 'axios';
import aj from '#config/arcjet.js';
import logger from '#config/logger.js';
import { processTokenPurchaseCallback } from '#services/myWallet.service.js';
import {
  buildMpesaPassword,
  darajaTimestamp,
  initiateBusinessPayment,
  initiateTokenPurchase,
  sendStkPush,
  toDarajaPhone,
} from '#utils/mpesa.js';
import { processCallbackHandler } from '#controllers/myWallet.controller.js';
import securityMiddleware from '#middleware/security.middleware.js';
import { validateMpesaWebhook } from '#middleware/webhookSecurity.middleware.js';

const envNames = [
  'MPESA_ENV',
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
  'MPESA_TILL_NUMBER',
  'MPESA_SHORTCODE',
  'MPESA_PASSKEY',
  'MPESA_ACCOUNT_REFERENCE',
  'MPESA_TOKEN_CALLBACK_URL',
  'MPESA_SALES_CALLBACK_URL',
  'MPESA_FORCE_TRANSACTION_TYPE',
  'MPESA_SKIP_IP_CHECK',
];
const originalEnv = Object.fromEntries(
  envNames.map(name => [name, process.env[name]])
);

const sandboxSuccess = () => ({
  data: {
    ResponseCode: '0',
    ResponseDescription: 'Success',
    CheckoutRequestID: 'ws_CO_test',
    MerchantRequestID: 'mr_test',
    CustomerMessage: 'Success',
  },
});

beforeEach(() => {
  process.env.MPESA_ENV = 'sandbox';
  process.env.MPESA_CONSUMER_KEY = 'test-key';
  process.env.MPESA_CONSUMER_SECRET = 'test-secret';
  process.env.MPESA_TILL_NUMBER = '174379';
  process.env.MPESA_SHORTCODE = '174379';
  process.env.MPESA_PASSKEY = 'test-passkey';
  process.env.MPESA_ACCOUNT_REFERENCE = 'PayMeTokens';
  process.env.MPESA_TOKEN_CALLBACK_URL =
    'https://example.ngrok.app/api/wallet/callback/token-purchase';
  process.env.MPESA_SALES_CALLBACK_URL =
    'https://example.ngrok.app/api/sales/mpesa/callback';
  delete process.env.MPESA_FORCE_TRANSACTION_TYPE;
  delete process.env.MPESA_SKIP_IP_CHECK;

  axios.get.mockResolvedValue({ data: { access_token: 'test-access-token' } });
  axios.post.mockResolvedValue(sandboxSuccess());
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: { access_token: 'test-access-token' } });
  axios.post.mockResolvedValue(sandboxSuccess());
});

afterAll(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('M-Pesa shared STK helpers', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['+254712345678', '254712345678'],
    ['254712345678', '254712345678'],
    ['712345678', '254712345678'],
    ['0112345678', '254112345678'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(toDarajaPhone(input)).toBe(expected);
  });

  it.each(['12345', '0212345678'])('rejects invalid phone %s', phone => {
    expect(() => toDarajaPhone(phone)).toThrow('Invalid Kenyan phone number');
  });

  it('creates Daraja timestamps in East Africa Time', () => {
    const afternoon = darajaTimestamp(new Date('2026-10-29T12:34:56.789Z'));
    expect(afternoon).toBe('20261029153456');
    expect(afternoon).toMatch(/^\d{14}$/);
    const midnight = darajaTimestamp(new Date('2026-10-29T22:30:05Z'));
    expect(midnight).toBe('20261030013005');
    expect(midnight).toMatch(/^\d{14}$/);
  });

  it('builds the STK password from shortcode, passkey, and timestamp', () => {
    const result = buildMpesaPassword(
      '174379',
      'sandbox-passkey',
      new Date('2026-10-29T12:34:56.789Z')
    );
    expect(result.timestamp).toBe('20261029153456');
    expect(result.password).toBe(
      Buffer.from('174379sandbox-passkey20261029153456').toString('base64')
    );
  });

  it('shows Daraja OAuth error details when credentials are rejected', async () => {
    axios.get.mockRejectedValueOnce({
      message: 'Request failed',
      response: {
        status: 400,
        data: { error: 'invalid_client' },
      },
    });

    await expect(
      initiateTokenPurchase({
        phone: '0708374149',
        amount: 10,
        accountReference: 'TOKEN-TEST',
      })
    ).rejects.toThrow(
      'M-Pesa OAuth failed (check key/secret vs MPESA_ENV): 400 — invalid_client'
    );
  });

  it('sends digits-only phone values and caps account and description lengths', async () => {
    await sendStkPush({
      label: 'test',
      shortcode: '174379',
      partyB: '174379',
      passkey: 'sandbox-passkey',
      transactionType: 'CustomerPayBillOnline',
      amount: 10,
      phone: '+254712345678',
      accountReference: 'A'.repeat(20),
      description: 'D'.repeat(20),
      callbackUrl: 'https://example.ngrok.app/callback',
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.PartyA).toBe('254712345678');
    expect(payload.PhoneNumber).toBe('254712345678');
    expect(payload.PartyA).not.toContain('+');
    expect(payload.PhoneNumber).not.toContain('+');
    expect(payload.AccountReference).toHaveLength(12);
    expect(payload.TransactionDesc).toHaveLength(13);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      payload.Password
    );
  });

  it('honors the transaction type override only outside production', async () => {
    process.env.MPESA_FORCE_TRANSACTION_TYPE = 'CustomerPayBillOnline';
    await sendStkPush({
      label: 'sandbox',
      shortcode: '174379',
      partyB: '174379',
      passkey: 'sandbox-passkey',
      transactionType: 'CustomerBuyGoodsOnline',
      amount: 10,
      phone: '0712345678',
      accountReference: 'SHOP001',
      description: 'Test',
      callbackUrl: 'https://example.ngrok.app/callback',
    });
    expect(axios.post.mock.calls[0][1].TransactionType).toBe(
      'CustomerPayBillOnline'
    );

    process.env.MPESA_ENV = 'production';
    await sendStkPush({
      label: 'production',
      shortcode: '123456',
      partyB: '123456',
      passkey: 'production-passkey',
      transactionType: 'CustomerBuyGoodsOnline',
      amount: 10,
      phone: '0712345678',
      accountReference: 'SHOP001',
      description: 'Test',
      callbackUrl: 'https://example.com/callback',
    });
    expect(axios.post.mock.calls[1][1].TransactionType).toBe(
      'CustomerBuyGoodsOnline'
    );
  });

  it('rejects non-HTTPS callbacks before making network requests', async () => {
    await expect(
      sendStkPush({
        label: 'test',
        shortcode: '174379',
        partyB: '174379',
        passkey: 'sandbox-passkey',
        transactionType: 'CustomerPayBillOnline',
        amount: 10,
        phone: '0712345678',
        accountReference: 'SHOP001',
        description: 'Test',
        callbackUrl: 'http://example.com/callback',
      })
    ).rejects.toThrow('Callback URL must be a public HTTPS URL');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('throws on a non-zero Daraja response code', async () => {
    axios.post.mockResolvedValueOnce({
      data: { ResponseCode: '1', ResponseDescription: 'Rejected' },
    });
    await expect(
      sendStkPush({
        label: 'test',
        shortcode: '174379',
        partyB: '174379',
        passkey: 'sandbox-passkey',
        transactionType: 'CustomerPayBillOnline',
        amount: 10,
        phone: '0712345678',
        accountReference: 'SHOP001',
        description: 'Test',
        callbackUrl: 'https://example.ngrok.app/callback',
      })
    ).rejects.toThrow('M-Pesa error: 1 — Rejected');
  });

  it('includes Daraja 400 errorMessage in the thrown error', async () => {
    axios.post.mockRejectedValueOnce({
      message: 'Request failed',
      response: {
        status: 400,
        data: { errorMessage: 'Invalid CallBackURL' },
      },
    });
    await expect(
      sendStkPush({
        label: 'test',
        shortcode: '174379',
        partyB: '174379',
        passkey: 'sandbox-passkey',
        transactionType: 'CustomerPayBillOnline',
        amount: 10,
        phone: '0712345678',
        accountReference: 'SHOP001',
        description: 'Test',
        callbackUrl: 'https://example.ngrok.app/callback',
      })
    ).rejects.toThrow('Invalid CallBackURL');
  });

  it('uses platform till and token callback env for token purchases', async () => {
    await initiateTokenPurchase({
      phone: '0708374149',
      amount: 10,
      accountReference: 'TOKEN-TEST',
    });
    const payload = axios.post.mock.calls[0][1];
    expect(payload.PartyB).toBe('174379');
    expect(payload.CallBackURL).toBe(process.env.MPESA_TOKEN_CALLBACK_URL);
  });

  it('uses the saved business shortcode and sales callback env', async () => {
    await initiateBusinessPayment({
      paymentConfig: {
        payment_method: 'paybill',
        shortcode: '123456',
        passkey: 'merchant-passkey',
        account_reference: 'SHOP001',
        is_active: true,
      },
      phone: '0708374149',
      amount: 10,
      description: 'PM-1',
    });
    const payload = axios.post.mock.calls[0][1];
    expect(payload.BusinessShortCode).toBe('123456');
    expect(payload.CallBackURL).toBe(process.env.MPESA_SALES_CALLBACK_URL);
  });

  it('reports missing flow-specific environment variables', async () => {
    delete process.env.MPESA_TILL_NUMBER;
    await expect(
      initiateTokenPurchase({
        phone: '0708374149',
        amount: 10,
        accountReference: 'TOKEN-TEST',
      })
    ).rejects.toThrow('Missing MPESA_TILL_NUMBER');

    process.env.MPESA_TILL_NUMBER = '174379';
    delete process.env.MPESA_SALES_CALLBACK_URL;
    await expect(
      initiateBusinessPayment({
        paymentConfig: {
          payment_method: 'paybill',
          shortcode: '123456',
          passkey: 'merchant-passkey',
          account_reference: 'SHOP001',
          is_active: true,
        },
        phone: '0708374149',
        amount: 10,
        description: 'PM-1',
      })
    ).rejects.toThrow('Missing MPESA_SALES_CALLBACK_URL');
  });
});

describe('M-Pesa webhook behavior', () => {
  const makeRequest = ip => ({
    ip,
    connection: {},
    body: { Body: { stkCallback: { CheckoutRequestID: 'ws_CO_test' } } },
    get: jest.fn(() => undefined),
  });

  const makeResponse = () => {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
  };

  it('accepts IPv4-mapped Safaricom sandbox IP addresses', () => {
    process.env.MPESA_SKIP_IP_CHECK = 'false';
    const middleware = validateMpesaWebhook();
    const req = makeRequest('::ffff:197.136.192.10');
    const res = makeResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not honor the IP-check skip flag in production', () => {
    process.env.MPESA_ENV = 'production';
    process.env.MPESA_SKIP_IP_CHECK = 'true';
    const middleware = validateMpesaWebhook();
    const req = makeRequest('203.0.113.10');
    const res = makeResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('skips only IP validation when the sandbox flag is enabled', () => {
    process.env.MPESA_SKIP_IP_CHECK = 'true';
    const middleware = validateMpesaWebhook();
    const req = makeRequest('203.0.113.10');
    const res = makeResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'M-Pesa webhook IP check disabled by MPESA_SKIP_IP_CHECK',
      { environment: 'sandbox' }
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps body validation active when the sandbox IP check is skipped', () => {
    process.env.MPESA_SKIP_IP_CHECK = 'true';
    const middleware = validateMpesaWebhook();
    const req = makeRequest('203.0.113.10');
    req.body = {};
    const res = makeResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps timestamp validation active when the sandbox IP check is skipped', () => {
    process.env.MPESA_SKIP_IP_CHECK = 'true';
    const middleware = validateMpesaWebhook();
    const req = makeRequest('203.0.113.10');
    req.body.Body.stkCallback.CallbackMetadata = {
      Item: [{ Name: 'TransactionDate', Value: '20000101000000' }],
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('Arcjet callback exemptions', () => {
  const callbackPaths = [
    '/api/wallet/callback/token-purchase',
    '/api/my-wallet/callback',
    '/api/sales/mpesa/callback',
  ];

  beforeEach(() => {
    aj.withRule.mockReturnValue({
      protect: jest.fn().mockResolvedValue({ isDenied: () => false }),
    });
  });

  it.each(callbackPaths)('bypasses Arcjet for POST %s', async path => {
    const next = jest.fn();

    await securityMiddleware({ method: 'POST', path }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(aj.withRule).not.toHaveBeenCalled();
  });

  it('continues to apply Arcjet to non-webhook routes', async () => {
    const next = jest.fn();

    await securityMiddleware({ method: 'GET', path: '/health' }, {}, next);

    expect(aj.withRule).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('my-wallet M-Pesa callback handler', () => {
  const callback = {
    MerchantRequestID: 'mr_test',
    CheckoutRequestID: 'ws_CO_test',
    ResultCode: 0,
    ResultDesc: 'Success',
    CallbackMetadata: { Item: [] },
  };
  const req = { body: { Body: { stkCallback: callback } } };
  const makeResponse = () => {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    processTokenPurchaseCallback.mockResolvedValue({ status: 'success' });
  });

  it('passes the unwrapped successful callback to the token credit service', async () => {
    const res = makeResponse();

    await processCallbackHandler(req, res);

    expect(processTokenPurchaseCallback).toHaveBeenCalledWith(callback);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ResultCode: 0,
      ResultDesc: 'Accepted',
    });
  });

  it('always acknowledges a callback when processing throws', async () => {
    processTokenPurchaseCallback.mockRejectedValueOnce(
      new Error('processing failed')
    );
    const res = makeResponse();

    await processCallbackHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ResultCode: 0,
      ResultDesc: 'Accepted',
    });
  });

  it('acknowledges malformed callbacks with HTTP 200', async () => {
    const res = makeResponse();

    await processCallbackHandler({ body: {} }, res);

    expect(processTokenPurchaseCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ResultCode: 0,
      ResultDesc: 'Accepted',
    });
  });
});
