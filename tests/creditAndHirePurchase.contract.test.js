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

import { db } from '#config/database.js';
import { getCreditSalesHistory } from '../src/controllers/credit.controller.js';
import { listAgreementsHandler } from '../src/controllers/higherPurchase.controller.js';
import { getCreditSalesForBusiness } from '#services/credit.service.js';
import { getHirePurchaseSalesForBusiness } from '#services/higherPurchase.service.js';

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
});
