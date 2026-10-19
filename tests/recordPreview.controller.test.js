jest.mock('#services/record.service.js', () => ({
  createRecord: jest.fn(),
  getRecords: jest.fn(),
  getRecordById: jest.fn(),
  calculateTotals: jest.fn(),
  getDashboardInsights: jest.fn(),
}));

jest.mock('#services/statementService.js', () => ({
  generateBusinessStatement: jest.fn(),
}));

jest.mock('#services/sales.service.js', () => ({
  getStatementFinancials: jest.fn(),
}));

import { getStatementFinancialsPreview } from '../src/controllers/record.controller.js';
import { getStatementFinancials } from '#services/sales.service.js';

describe('getStatementFinancialsPreview', () => {
  it('returns the financial summary payload from the sales service', async () => {
    const mockFinancials = {
      ledgerRows: [],
      totals: { gross_revenue: 1250 },
    };

    getStatementFinancials.mockResolvedValue(mockFinancials);

    const req = {
      params: { business_id: '7' },
      query: {
        start_date: '2026-01-01',
        end_date: '2026-01-31',
      },
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await getStatementFinancialsPreview(req, res, next);

    expect(getStatementFinancials).toHaveBeenCalledWith(
      7,
      expect.any(Date),
      expect.any(Date)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        financials: mockFinancials,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
