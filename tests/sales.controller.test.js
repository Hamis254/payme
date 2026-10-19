jest.mock('#config/logger.js', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    __esModule: true,
    default: logger,
  };
});

jest.mock('#config/database.js', () => {
  const db = {
    transaction: jest.fn(),
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  };

  return {
    __esModule: true,
    db,
  };
});

// applyCallback owns the transaction now; the controller's job is only to
// parse the callback, dispatch, and run the post-commit side effects. Those
// are what this suite checks.
jest.mock('#services/mpesaAttempt.service.js', () => ({
  __esModule: true,
  applyCallback: jest.fn(),
}));

jest.mock('#services/stock.service.js', () => ({
  __esModule: true,
  checkAndNotifyLowStock: jest.fn(async () => undefined),
}));

jest.mock('#services/record.service.js', () => ({
  __esModule: true,
  createRecord: jest.fn(async () => undefined),
}));

jest.mock('#utils/notificationEmitter.js', () => ({
  __esModule: true,
  emitNotification: jest.fn(async () => undefined),
  notifications: {
    paymentComplete: jest.fn(() => ({ type: 'payment_complete' })),
  },
}));

jest.mock('#models/sales.model.js', () => ({
  __esModule: true,
  sales: { name: 'sales' },
  saleItems: { name: 'saleItems' },
}));

jest.mock('#models/payments.model.js', () => ({
  __esModule: true,
  payments: {},
}));

jest.mock('#models/myWallet.model.js', () => ({
  __esModule: true,
  wallets: {},
  walletTransactions: {},
}));

jest.mock('#models/setting.model.js', () => ({
  __esModule: true,
  businesses: {},
}));

jest.mock('#validations/sales.validation.js', () => ({
  __esModule: true,
  mpesaCallbackSchema: {
    safeParse: ({ Body }) => {
      if (!Body?.stkCallback) {
        return { success: false, error: {} };
      }
      return { success: true, data: Body.stkCallback };
    },
  },
}));

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { applyCallback } from '#services/mpesaAttempt.service.js';
import { checkAndNotifyLowStock } from '#services/stock.service.js';
import { createRecord } from '#services/record.service.js';
import { emitNotification } from '#utils/notificationEmitter.js';
import { mpesaCallbackHandler } from '../src/controllers/sales.controller.js';

const makeReq = (resultCode, extra = {}) => ({
  body: {
    Body: {
      stkCallback: {
        CheckoutRequestID: 'ws_CO_123',
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? 'Success' : 'Transaction failed',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 100 },
            { Name: 'MpesaReceiptNumber', Value: 'RJ12ABC' },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
        ...extra,
      },
    },
  },
});

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe('mpesaCallbackHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Only used by the success path, to look up the business owner.
    db.select.mockImplementation(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => [{ user_id: 3 }]),
        })),
      })),
    }));
  });

  it('does not touch stock, tokens or notifications for failed payments', async () => {
    applyCallback.mockResolvedValue({
      outcome: 'failed',
      attemptId: 9,
      businessId: 7,
      resultCode: 1032,
    });

    const res = makeRes();
    await mpesaCallbackHandler(makeReq(1032), res);

    expect(checkAndNotifyLowStock).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
    expect(emitNotification).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Callback processed',
        outcome: 'failed',
      })
    );
    // A cancelled payment is an ordinary outcome, not an incident.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports no sale id for a failed payment', async () => {
    applyCallback.mockResolvedValue({
      outcome: 'failed',
      attemptId: 9,
      businessId: 7,
      resultCode: 1,
    });

    const res = makeRes();
    await mpesaCallbackHandler(makeReq(1), res);

    expect(res.json.mock.calls[0][0]).not.toHaveProperty('sale_id');
  });

  it('parses callback metadata and forwards it to applyCallback', async () => {
    applyCallback.mockResolvedValue({
      outcome: 'failed',
      attemptId: 9,
      businessId: 7,
      resultCode: 1,
    });

    await mpesaCallbackHandler(makeReq(1), makeRes());

    expect(applyCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutRequestId: 'ws_CO_123',
        resultCode: 1,
        amount: 100,
        mpesaReceiptNumber: 'RJ12ABC',
        phoneNumber: '254712345678',
      })
    );
  });

  it('runs token/ledger, low-stock and notification side effects on success', async () => {
    applyCallback.mockResolvedValue({
      outcome: 'success',
      attemptId: 9,
      saleId: 42,
      businessId: 7,
      userId: 3,
      amount: 100,
      mpesaReceiptNumber: 'RJ12ABC',
      phoneNumber: '254712345678',
      items: [
        {
          product_id: 101,
          product_name: 'Rice',
          quantity: 1,
          unit_price: 100,
          unit_cost: 50,
        },
      ],
    });

    const res = makeRes();
    await mpesaCallbackHandler(makeReq(0), res);

    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 7,
        category: 'mpesa',
        reference_id: '42',
        amount: 100,
      })
    );
    expect(checkAndNotifyLowStock).toHaveBeenCalledWith(7, 101);
    expect(emitNotification).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', sale_id: 42 })
    );
  });

  it('still returns 200 and keeps the sale when the token ledger write fails', async () => {
    applyCallback.mockResolvedValue({
      outcome: 'success',
      attemptId: 9,
      saleId: 42,
      businessId: 7,
      userId: 3,
      amount: 100,
      mpesaReceiptNumber: 'RJ12ABC',
      phoneNumber: '254712345678',
      items: [],
    });
    createRecord.mockRejectedValueOnce(new Error('wallet unavailable'));

    const res = makeRes();
    await mpesaCallbackHandler(makeReq(0), res);

    // The customer has already paid — a billing hiccup must not undo it.
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', sale_id: 42 })
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('is a no-op on a duplicate callback', async () => {
    applyCallback.mockResolvedValue({
      outcome: 'duplicate',
      attemptId: 9,
      status: 'success',
      saleId: 42,
    });

    const res = makeRes();
    await mpesaCallbackHandler(makeReq(0), res);

    expect(createRecord).not.toHaveBeenCalled();
    expect(emitNotification).not.toHaveBeenCalled();
    expect(checkAndNotifyLowStock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'already_processed' })
    );
  });

  it('loudly logs a successful payment with no staged attempt', async () => {
    applyCallback.mockResolvedValue({ outcome: 'no_attempt' });

    const res = makeRes();
    await mpesaCallbackHandler(makeReq(0), res);

    // Money received against a cart we never recorded — needs a human.
    expect(logger.error).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unknown_attempt' })
    );
  });

  it('ignores a malformed callback without calling applyCallback', async () => {
    const res = makeRes();
    await mpesaCallbackHandler({ body: {} }, res);

    expect(applyCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ignored' })
    );
  });
});
