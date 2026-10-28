jest.mock('#config/database.js', () => ({
  db: { transaction: jest.fn() },
}));

jest.mock('#services/sales.service.js', () => ({
  createSale: jest.fn(),
}));

jest.mock('#services/record.service.js', () => ({
  createRecord: jest.fn(),
}));

jest.mock('#services/tokenLots.service.js', () => ({
  getSpendableBalance: jest.fn(async () => 10),
}));

jest.mock('#services/paymentConfig.service.js', () => ({
  getPaymentConfig: jest.fn(),
}));

jest.mock('#services/credit.service.js', () => ({
  createCreditSale: jest.fn(),
  assessCreditStockRisk: jest.fn(),
}));

jest.mock('#services/higherPurchase.service.js', () => ({
  createAgreement: jest.fn(),
}));

jest.mock('#utils/notificationEmitter.js', () => ({
  emitNotification: jest.fn(),
  notifications: {
    paymentComplete: jest.fn(args => ({
      type: 'payment_complete',
      metadata: args,
    })),
    creditSaleCreated: jest.fn(args => ({
      type: 'credit_sale_created',
      metadata: args,
    })),
    hpAgreementCreated: jest.fn(args => ({
      type: 'hp_agreement_created',
      metadata: args,
    })),
  },
}));

import { db } from '#config/database.js';
import { createSale } from '#services/sales.service.js';
import { createRecord } from '#services/record.service.js';
import {
  assessCreditStockRisk,
  createCreditSale,
} from '#services/credit.service.js';
import { createAgreement } from '#services/higherPurchase.service.js';
import { emitNotification, notifications } from '#utils/notificationEmitter.js';
import { processPayMe } from '../src/controllers/payme.controller.js';

const successfulSale = {
  sale: {
    id: 501,
    business_id: 7,
    total_amount: 250,
    payment_mode: 'cash',
  },
  items: [],
  summary: { total_amount: 250 },
};

function makeRequest(body) {
  return { user: { id: 10 }, body };
}

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  createSale.mockResolvedValue(successfulSale);
  createRecord.mockResolvedValue({});
  assessCreditStockRisk.mockResolvedValue({ atRisk: false });
  createCreditSale.mockResolvedValue({
    creditSale: { id: 601 },
    account: { balance_due: '250' },
  });
  createAgreement.mockResolvedValue({
    agreement: { id: 701, total_amount: '300' },
  });
});

describe('PayMe post-commit notifications', () => {
  it('starts the cash-sale notification only after the transaction commits', async () => {
    let committed = false;
    db.transaction.mockImplementation(async callback => {
      const result = await callback({});
      committed = true;
      return result;
    });
    emitNotification.mockImplementation(() => {
      expect(committed).toBe(true);
      return Promise.resolve();
    });
    const req = makeRequest({
      business_id: 7,
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'cash',
    });
    const res = makeResponse();

    await processPayMe(req, res, jest.fn());

    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(notifications.paymentComplete).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 250, sale_id: 501 })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('does not notify when the cash-sale transaction rolls back', async () => {
    db.transaction.mockImplementation(async callback => {
      await callback({});
      throw new Error('transaction rolled back');
    });
    const req = makeRequest({
      business_id: 7,
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'cash',
    });
    const res = makeResponse();

    await processPayMe(req, res, jest.fn());

    expect(emitNotification).not.toHaveBeenCalled();
  });

  it('starts the credit-sale notification only after the combined transaction commits', async () => {
    let committed = false;
    db.transaction.mockImplementation(async callback => {
      const result = await callback({});
      committed = true;
      return result;
    });
    emitNotification.mockImplementation(() => {
      expect(committed).toBe(true);
      return Promise.resolve();
    });
    const req = makeRequest({
      business_id: 7,
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'credit',
      customer_type: 'credit',
      customer_name: 'Customer',
      credit_account_id: 4,
      credit_due_date: '2026-11-01',
    });
    const res = makeResponse();

    await processPayMe(req, res, jest.fn());

    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(notifications.creditSaleCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        credit_sale_id: 601,
        amount: 250,
        balance_remaining: '250',
        business_id: 7,
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('starts the HP agreement notification only after the combined transaction commits', async () => {
    let committed = false;
    db.transaction.mockImplementation(async callback => {
      const result = await callback({});
      committed = true;
      return result;
    });
    emitNotification.mockImplementation(() => {
      expect(committed).toBe(true);
      return Promise.resolve();
    });
    const req = makeRequest({
      business_id: 7,
      items: [{ product_id: 1, quantity: 1 }],
      payment_mode: 'hire_purchase',
      customer_type: 'hire_purchase',
      customer_name: 'Customer',
      hp_account_id: 4,
      hp_interest_rate: 0,
      hp_down_payment: 0,
      hp_installment_amount: 30,
      hp_installment_frequency: 'monthly',
      hp_number_of_installments: 10,
      hp_first_payment_date: '2026-11-01',
    });
    const res = makeResponse();

    await processPayMe(req, res, jest.fn());

    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(notifications.hpAgreementCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        agreement_id: 701,
        amount: 300,
        customer_name: 'Customer',
        business_id: 7,
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
