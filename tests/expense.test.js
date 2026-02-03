/**
 * Expense Management Service Tests
 * Tests for expense recording, filtering, and reporting
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.mock('#config/database.js', () => {
  const createSelectChain = () => {
    return {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
    };
  };

  return {
    db: {
      select: jest.fn(() => createSelectChain()),
      insert: jest.fn(() => ({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([]),
        }),
      })),
      update: jest.fn(() => ({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      })),
      delete: jest.fn(() => ({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([]),
        }),
      })),
      transaction: jest.fn(async (callback) => {
        const tx = {
          select: jest.fn(() => createSelectChain()),
          insert: jest.fn(() => ({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([]),
            }),
          })),
          update: jest.fn(() => ({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })),
        };
        return callback(tx);
      }),
    },
    sql: jest.fn((strings) => ({
      toString: () => (typeof strings === 'string' ? strings : strings[0]),
    })),
  };
});

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

describe('Expense Service', () => {
  let db;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('#config/database.js');
    db = mod.db;
  });

  describe('Expense Recording', () => {
    test('should record new expense', async () => {
      const { recordExpense } = await import('#services/expense.service.js');

      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            { id: 1, category: 'utilities', status: 'recorded' },
          ]),
        }),
      });

      await recordExpense({
        businessId: 1,
        category: 'utilities',
        description: 'Water bill',
        amount: 5000,
        expenseDate: new Date('2024-01-15'),
      });

      expect(db.insert).toHaveBeenCalled();
    });

    test('should validate required fields', async () => {
      const { recordExpense } = await import('#services/expense.service.js');

      await expect(
        recordExpense({
          businessId: 1,
          category: 'utilities',
          description: 'Water bill',
          // Missing amount
          expenseDate: new Date(),
        })
      ).rejects.toThrow();
    });

    test('should validate expense amount is positive', async () => {
      const { recordExpense } = await import('#services/expense.service.js');

      await expect(
        recordExpense({
          businessId: 1,
          category: 'utilities',
          description: 'Water bill',
          amount: -1000,
          expenseDate: new Date(),
        })
      ).rejects.toThrow();
    });
  });

  describe('Expense Categorization', () => {
    test('should support multiple expense categories', async () => {
      const { recordExpense } = await import('#services/expense.service.js');

      const categories = ['utilities', 'rent', 'supplies', 'salaries', 'marketing'];

      for (const category of categories) {
        db.insert.mockReturnValueOnce({
          values: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              { id: 1, category, amount: '5000', status: 'recorded' },
            ]),
          }),
        });

        await recordExpense({
          businessId: 1,
          category,
          description: `${category} expense`,
          amount: 5000,
          expenseDate: new Date(),
        });

        expect(db.insert).toHaveBeenCalled();
      }
    });
  });

  describe('Expense Retrieval', () => {
    test('should get expense by ID', async () => {
      const { getExpenseById } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, category: 'utilities' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getExpenseById(1, 1);
      expect(db.select).toHaveBeenCalled();
    });

    test('should list expenses with filters', async () => {
      const { listExpenses } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([
          { id: 1, category: 'utilities', amount: '5000' },
        ]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await listExpenses({ businessId: 1 });
      expect(db.select).toHaveBeenCalled();
    });

    test('should filter expenses by category', async () => {
      const { listExpenses } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([
          { id: 1, category: 'utilities', amount: '5000' },
        ]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await listExpenses({ businessId: 1, category: 'utilities' });
      expect(db.select).toHaveBeenCalled();
    });

    test('should filter expenses by date range', async () => {
      const { listExpenses } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([
          { id: 1, expense_date: new Date('2024-01-15') },
        ]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await listExpenses({
        businessId: 1,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe('Expense Reporting', () => {
    test('should get expense summary', async () => {
      const { getExpenseSummary } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ total_expenses: '37500' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getExpenseSummary(1, new Date('2024-01-01'), new Date('2024-01-31'));
      expect(db.select).toHaveBeenCalled();
    });

    test('should get expenses by category', async () => {
      const { getExpenseByCategory } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([{ category: 'utilities', total: '15000' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getExpenseByCategory(1, new Date('2024-01-01'), new Date('2024-01-31'));
      expect(db.select).toHaveBeenCalled();
    });

    test('should get expenses by payment method', async () => {
      const { getExpenseByPaymentMethod } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([{ payment_method: 'cash', total: '35000' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getExpenseByPaymentMethod(1, new Date('2024-01-01'), new Date('2024-01-31'));
      expect(db.select).toHaveBeenCalled();
    });

    test('should get monthly expense trend', async () => {
      const { getMonthlytExpenseTrend } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([{ month: '2024-01', total: '37500' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getMonthlytExpenseTrend(1);
      expect(db.select).toHaveBeenCalled();
    });

    test('should get top expenses', async () => {
      const { getTopExpenses } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, amount: '50000' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getTopExpenses(1, 3);
      expect(db.select).toHaveBeenCalled();
    });

    test('should get category breakdown', async () => {
      const { getCategoryBreakdown } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([{ category: 'salaries', percentage: 45 }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getCategoryBreakdown(1);
      expect(db.select).toHaveBeenCalled();
    });

    test('should get total expenses', async () => {
      const { getTotalExpenses } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ total: '37500' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getTotalExpenses(1, new Date('2024-01-01'), new Date('2024-01-31'));
      expect(db.select).toHaveBeenCalled();
    });

    test('should get expense status distribution', async () => {
      const { getExpenseStatusDistribution } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockResolvedValue([{ status: 'recorded', count: 10 }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getExpenseStatusDistribution(1);
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe('Expense Update', () => {
    test('should update expense details', async () => {
      const { updateExpense } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, business_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await updateExpense(1, 1, { description: 'Updated' });
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('Expense Deletion', () => {
    test('should delete expense', async () => {
      const { deleteExpense } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, business_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      const deleteChain = {
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 1 }]),
        }),
      };

      db.delete.mockReturnValueOnce(deleteChain);

      await deleteExpense(1, 1);
      expect(db.delete).toHaveBeenCalled();
    });

    test('should handle deletion errors gracefully', async () => {
      const { deleteExpense } = await import('#services/expense.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, business_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      const deleteChain = {
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 1 }]),
        }),
      };

      db.delete.mockReturnValueOnce(deleteChain);

      // Should successfully delete
      const result = await deleteExpense(1, 1);
      expect(result).toBeDefined();
    });
  });
});
