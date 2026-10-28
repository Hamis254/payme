jest.mock('#config/database.js', () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock('#services/credit.service.js', () => ({
  getCreditSalesForBusiness: jest.fn(),
}));

jest.mock('#services/higherPurchase.service.js', () => ({
  createAgreement: jest.fn(),
  getAgreementById: jest.fn(),
  listAgreements: jest.fn(),
  recordInstallmentPayment: jest.fn(),
  getOverdueInstallments: jest.fn(),
  getUpcomingInstallments: jest.fn(),
  getAgreementSummary: jest.fn(),
  getStatusDistribution: jest.fn(),
  updateAgreementStatus: jest.fn(),
  getPaymentHistory: jest.fn(),
  getCollectionRate: jest.fn(),
  getHirePurchaseSalesForBusiness: jest.fn(),
}));

jest.mock('#utils/notificationEmitter.js', () => ({
  emitNotification: jest.fn(() => Promise.resolve()),
  notifications: {
    creditSaleCreated: jest.fn(args => ({ type: 'credit_sale_created', metadata: args })),
    creditPaymentReceived: jest.fn(args => ({
      type: 'credit_payment_received',
      metadata: args,
    })),
    hpAgreementCreated: jest.fn(args => ({
      type: 'hp_agreement_created',
      metadata: args,
    })),
    hpInstallmentReceived: jest.fn(args => ({
      type: 'hp_installment_received',
      metadata: args,
    })),
  },
}));

import { db } from '#config/database.js';
import { getCreditSalesHistory } from '../src/controllers/credit.controller.js';
import {
  createAgreementHandler,
  listAgreementsHandler,
  recordPaymentHandler,
} from '../src/controllers/higherPurchase.controller.js';
import { getCreditSalesForBusiness } from '#services/credit.service.js';
import {
  getHirePurchaseSalesForBusiness,
  recordInstallmentPayment,
  createAgreement,
} from '#services/higherPurchase.service.js';
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

describe('frontend truth-data contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 7 }]),
        }),
      }),
    });
  });

  it('returns a summary with credit sales for the frontend', async () => {
    getCreditSalesForBusiness.mockResolvedValue({
      credit_sales: [{ id: 1, status: 'open' }],
      summary: {
        total_outstanding: 1500,
        overdue_count: 1,
      },
    });

    const req = {
      user: { id: 10 },
      params: { businessId: '7' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await getCreditSalesHistory(req, res, next);

    expect(getCreditSalesForBusiness).toHaveBeenCalledWith(10, 7);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Credit sales retrieved successfully',
        credit_sales: [{ id: 1, status: 'open' }],
        summary: {
          total_outstanding: 1500,
          overdue_count: 1,
        },
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns richer hire-purchase data plus summary for the frontend', async () => {
    getHirePurchaseSalesForBusiness.mockResolvedValue({
      hire_purchase_sales: [{ id: 1, status: 'active' }],
      summary: {
        total_agreements: 1,
        total_remaining: 5000,
      },
    });

    const req = {
      user: { id: 10 },
      params: { businessId: '7' },
      query: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await listAgreementsHandler(req, res, next);

    expect(getHirePurchaseSalesForBusiness).toHaveBeenCalledWith(7, {
      status: undefined,
      startDate: undefined,
      endDate: undefined,
      limit: 50,
      offset: 0,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        count: 1,
        agreements: [{ id: 1, status: 'active' }],
        hire_purchase_sales: [{ id: 1, status: 'active' }],
        summary: {
          total_agreements: 1,
          total_remaining: 5000,
        },
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns PAYMENT_REQUIRED when the atomic installment token charge fails', async () => {
    recordInstallmentPayment.mockRejectedValueOnce(
      new Error('Insufficient tokens. Please purchase tokens to create records.')
    );
    const req = {
      user: { id: 10 },
      params: { businessId: '7', agreementId: '11' },
      body: { installmentId: 55, amountPaid: 2000, paymentMethod: 'cash' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await recordPaymentHandler(req, res, next);

    expect(recordInstallmentPayment).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 7, userId: 10 })
    );
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PAYMENT_REQUIRED' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('includes the remaining token balance in successful payment responses', async () => {
    recordInstallmentPayment.mockResolvedValueOnce({
      installment: {
        id: 55,
        installment_number: 1,
        amount_due: '2000',
        amount_paid: '2000',
        status: 'paid',
        payment_date: new Date('2026-08-02'),
      },
      agreement: { balance_remaining: '27457.6' },
      paymentRow: { id: 501 },
    });
    const req = {
      user: { id: 10 },
      params: { businessId: '7', agreementId: '11' },
      body: { installmentId: 55, amountPaid: 2000, paymentMethod: 'cash' },
      revenueGuard: { balance_before: 5 },
      id: 'request-1',
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await recordPaymentHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ tokens_remaining: 4 })
    );
    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(notifications.hpInstallmentReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: 501,
        amount: 2000,
        installment_number: 1,
        balance_remaining: 27457.6,
        business_id: 7,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('emits one hire-purchase agreement notification after creation succeeds', async () => {
    createAgreement.mockResolvedValueOnce({
      agreement: { id: 11, total_amount: '30000', customer_name: 'Customer' },
      installments: [{ id: 1 }],
    });
    const req = {
      user: { id: 10 },
      params: { businessId: '7' },
      body: {
        saleId: 3,
        accountId: 4,
        principalAmount: 30000,
        installmentAmount: 3000,
        installmentFrequency: 'monthly',
        numberOfInstallments: 10,
        agreementDate: '2026-10-01',
        firstPaymentDate: '2026-11-01',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await createAgreementHandler(req, res, next);

    expect(createAgreement).toHaveBeenCalledTimes(1);
    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(notifications.hpAgreementCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        agreement_id: 11,
        amount: 30000,
        business_id: 7,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('does not emit hire-purchase notifications when agreement creation fails', async () => {
    createAgreement.mockRejectedValueOnce(new Error('transaction rolled back'));
    const req = {
      user: { id: 10 },
      params: { businessId: '7' },
      body: {
        saleId: 3,
        accountId: 4,
        principalAmount: 30000,
        installmentAmount: 3000,
        installmentFrequency: 'monthly',
        numberOfInstallments: 10,
        agreementDate: '2026-10-01',
        firstPaymentDate: '2026-11-01',
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createAgreementHandler(req, res, next);

    expect(emitNotification).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'transaction rolled back' })
    );
  });

  it('does not emit an installment notification when its transaction fails', async () => {
    recordInstallmentPayment.mockRejectedValueOnce(
      new Error('transaction rolled back')
    );
    const req = {
      user: { id: 10 },
      params: { businessId: '7', agreementId: '11' },
      body: { installmentId: 55, amountPaid: 2000, paymentMethod: 'cash' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await recordPaymentHandler(req, res, next);

    expect(emitNotification).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'transaction rolled back' })
    );
  });
});
