/**
 * Credit Management Service Tests
 * Tests for credit account management, sales tracking, payments, and reporting
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.mock('#config/database.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(async (callback) => {
      const tx = {
        select: jest.fn(),
        insert: jest.fn(),
        update: jest.fn(),
      };
      return callback(tx);
    }),
  },
  sql: jest.fn(),
}));

jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('drizzle-orm', () => ({
  eq: (a, b) => ({ type: 'eq', a, b }),
  and: (...args) => ({ type: 'and', args }),
  desc: (a) => ({ type: 'desc', a }),
  gte: (a, b) => ({ type: 'gte', a, b }),
  lte: (a, b) => ({ type: 'lte', a, b }),
}));

describe('Credit Service', () => {
  let db;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('#config/database.js');
    db = mod.db;
  });

  describe('Credit Accounts', () => {
    test('should get credit account by ID', async () => {
      const { getCreditAccountById } = await import('#services/credit.service.js');

      const mockAccount = {
        account: {
          id: 1,
          business_id: 1,
          customer_id: 1,
          customer_name: 'John Doe',
          credit_limit: '50000',
          balance_due: '0',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        business: { id: 1, user_id: 1 },
      };

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAccount]),
            }),
          }),
        }),
      });

      const result = await getCreditAccountById(1, 1);

      expect(result).toBeDefined();
      expect(result.account.customer_name).toBe('John Doe');
      expect(result.account.credit_limit).toBe('50000');
    });

    test('should throw error if account not found', async () => {
      const { getCreditAccountById } = await import('#services/credit.service.js');

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      await expect(getCreditAccountById(1, 1)).rejects.toThrow(
        'Credit account not found or access denied'
      );
    });

    test('should get all credit accounts for business', async () => {
      const { getCreditAccountsForBusiness } = await import('#services/credit.service.js');

      const mockAccounts = [
        {
          id: 1,
          customer_id: 1,
          customer_name: 'John Doe',
          credit_limit: '50000',
          balance_due: '10000',
          is_active: true,
        },
        {
          id: 2,
          customer_id: 2,
          customer_name: 'Jane Smith',
          credit_limit: '30000',
          balance_due: '5000',
          is_active: true,
        },
      ];

      // First call for business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
          }),
        }),
      });

      // Second call for accounts retrieval
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockAccounts),
          }),
        }),
      });

      const result = await getCreditAccountsForBusiness(1, 1);

      expect(result).toBeDefined();
      expect(result.accounts).toBeDefined();
      expect(result.count).toBeGreaterThan(0);
    });

    test('should update credit account', async () => {
      const { updateCreditAccount } = await import('#services/credit.service.js');

      const mockAccount = {
        account: { id: 1, credit_limit: '60000' },
      };

      // Mock getCreditAccountById call
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAccount]),
            }),
          }),
        }),
      });

      // Mock update call
      db.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1, credit_limit: '60000' }]),
          }),
        }),
      });

      const result = await updateCreditAccount(1, 1, { credit_limit: '60000' });

      expect(result).toBeDefined();
      expect(result.credit_limit).toBe('60000');
    });

    test('should deactivate credit account with zero balance', async () => {
      const { deactivateCreditAccount } = await import('#services/credit.service.js');

      const mockAccount = {
        account: { id: 1, balance_due: '0', is_active: true },
      };

      // Mock getCreditAccountById call
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAccount]),
            }),
          }),
        }),
      });

      // Mock update call
      db.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1, is_active: false }]),
          }),
        }),
      });

      const result = await deactivateCreditAccount(1, 1);

      expect(result).toBeDefined();
      expect(result.is_active).toBe(false);
    });

    test('should throw error when deactivating account with outstanding balance', async () => {
      const { deactivateCreditAccount } = await import('#services/credit.service.js');

      const mockAccount = {
        account: { id: 1, balance_due: '5000', is_active: true },
      };

      // Mock getCreditAccountById call
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAccount]),
            }),
          }),
        }),
      });

      await expect(deactivateCreditAccount(1, 1)).rejects.toThrow(
        'Cannot deactivate account with outstanding balance'
      );
    });
  });

  describe('Credit Sales', () => {
    test('should get credit sales for account', async () => {
      const { getCreditSalesForAccount } = await import('#services/credit.service.js');

      const mockSales = [
        {
          creditSale: { id: 1, account_id: 1, outstanding_amount: '5000', status: 'open' },
          sale: { id: 1, total_amount: 5000 },
        },
      ];

      // Mock getCreditAccountById
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ account: { id: 1 } }]),
            }),
          }),
        }),
      });

      // Mock getCreditSalesForAccount
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockSales),
            }),
          }),
        }),
      });

      const result = await getCreditSalesForAccount(1, 1);

      expect(result).toBeDefined();
      expect(result.creditSales).toBeDefined();
    });

    test('should get credit sale with details', async () => {
      const { getCreditSaleWithDetails } = await import('#services/credit.service.js');

      const mockSaleDetails = {
        creditSale: { id: 1, account_id: 1, outstanding_amount: '5000' },
        account: { id: 1, customer_name: 'John Doe' },
        sale: { id: 1, total_amount: 5000 },
        business: { id: 1, user_id: 1 },
      };

      // Mock initial select
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn()
            .mockReturnValueOnce({
              innerJoin: jest.fn()
                .mockReturnValueOnce({
                  innerJoin: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue([mockSaleDetails]),
                    }),
                  }),
                }),
            }),
        }),
      });

      // Mock sale items fetch
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getCreditSaleWithDetails(1, 1);

      expect(result).toBeDefined();
    });
  });

  describe('Credit Payments', () => {
    test('should get credit payments for account', async () => {
      const { getCreditPaymentsForAccount } = await import('#services/credit.service.js');

      const mockPayments = [
        {
          id: 1,
          account_id: 1,
          amount: '5000',
          payment_method: 'cash',
          created_at: new Date(),
        },
      ];

      // Mock getCreditAccountById
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ account: { id: 1 } }]),
            }),
          }),
        }),
      });

      // Mock payments fetch
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockPayments),
          }),
        }),
      });

      const result = await getCreditPaymentsForAccount(1, 1);

      expect(result).toBeDefined();
      expect(result.payments).toBeDefined();
      expect(result.count).toBeGreaterThan(0);
    });
  });

  describe('Credit Ledger', () => {
    test('should get credit ledger for account', async () => {
      const { getCreditLedgerForAccount } = await import('#services/credit.service.js');

      const mockLedger = [
        {
          id: 1,
          account_id: 1,
          type: 'sale',
          amount: '5000',
          balance_after: '5000',
          created_at: new Date(),
        },
      ];

      // Mock getCreditAccountById
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ account: { id: 1 } }]),
            }),
          }),
        }),
      });

      // Mock ledger fetch
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockLedger),
          }),
        }),
      });

      const result = await getCreditLedgerForAccount(1, 1);

      expect(result).toBeDefined();
      expect(result.ledger).toBeDefined();
    });
  });

  describe('Credit Reporting', () => {
    test('should get credit summary for business', async () => {
      const { getCreditSummaryForBusiness } = await import('#services/credit.service.js');

      const mockAccounts = [
        { id: 1, is_active: true, balance_due: 5000, credit_limit: 50000 },
        { id: 2, is_active: true, balance_due: 3000, credit_limit: 30000 },
      ];

      const mockOverdueSales = [];

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
          }),
        }),
      });

      // Mock accounts fetch
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockAccounts),
        }),
      });

      // Mock overdue sales fetch
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockOverdueSales),
          }),
        }),
      });

      const result = await getCreditSummaryForBusiness(1, 1);

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.totalAccounts).toBe(2);
      expect(result.summary.activeAccounts).toBe(2);
    });

    test('should get aging report for business', async () => {
      const { getAgingReport } = await import('#services/credit.service.js');

      const mockOpenSales = [
        {
          creditSale: {
            id: 1,
            sale_id: 1,
            outstanding_amount: '5000',
            due_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
          },
          account: { id: 1, customer_name: 'John Doe' },
        },
      ];

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
          }),
        }),
      });

      // Mock open sales fetch
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockOpenSales),
          }),
        }),
      });

      const result = await getAgingReport(1, 1);

      expect(result).toBeDefined();
      expect(result.aging).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    test('should get customer statement', async () => {
      const { getCustomerStatement } = await import('#services/credit.service.js');

      const mockAccount = {
        account: { id: 1, customer_name: 'John Doe', balance_due: '5000' },
        business: { id: 1, name: 'Business Inc' },
      };

      const mockLedgerEntries = [
        {
          id: 1,
          type: 'sale',
          amount: '5000',
          balance_after: '5000',
          created_at: new Date(),
          reference: 'Sale #1',
          note: 'Sale on credit',
        },
      ];

      // Mock getCreditAccountById
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAccount]),
            }),
          }),
        }),
      });

      // Mock ledger fetch
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockLedgerEntries),
          }),
        }),
      });

      const result = await getCustomerStatement(1, 1, null, null);

      expect(result).toBeDefined();
      expect(result.account).toBeDefined();
      expect(result.statement).toBeDefined();
      expect(result.summary).toBeDefined();
    });
  });
});
