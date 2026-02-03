/**
 * Analytics Service Tests
 * Tests for business analytics, reporting, and metrics
 */

jest.mock('#config/database.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  sql: jest.fn(),
}));

jest.mock('#config/logger.js', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  return mockLogger;
});

jest.mock('drizzle-orm', () => ({
  eq: (a, b) => ({ type: 'eq', a, b }),
  and: (...args) => ({ type: 'and', args }),
  gte: (a, b) => ({ type: 'gte', a, b }),
  lte: (a, b) => ({ type: 'lte', a, b }),
  desc: (a) => ({ type: 'desc', a }),
  sum: (a) => ({ type: 'sum', a }),
  count: (a) => ({ type: 'count', a }),
  avg: (a) => ({ type: 'avg', a }),
}));

describe('Analytics Service', () => {
  let db;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('#config/database.js');
    db = mod.db;
  });

  describe('Date Range Calculations', () => {
    test('should calculate daily date range', async () => {
      const { getDateRange } = await import('#services/analytics.service.js');

      const { startDate, endDate } = getDateRange('daily');

      expect(startDate).toBeDefined();
      expect(endDate).toBeDefined();
      expect(typeof startDate).toBe('string');
      expect(typeof endDate).toBe('string');
    });

    test('should calculate weekly date range', async () => {
      const { getDateRange } = await import('#services/analytics.service.js');

      const { startDate, endDate } = getDateRange('weekly');

      expect(startDate).toBeDefined();
      expect(endDate).toBeDefined();
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
      
      expect(diffDays).toBeGreaterThanOrEqual(5);
      expect(diffDays).toBeLessThanOrEqual(8);
    });

    test('should calculate monthly date range', async () => {
      const { getDateRange } = await import('#services/analytics.service.js');

      const { startDate, endDate } = getDateRange('monthly');

      expect(startDate).toBeDefined();
      expect(endDate).toBeDefined();
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      expect(end > start).toBe(true);
    });

    test('should throw error for invalid period', async () => {
      const { getDateRange } = await import('#services/analytics.service.js');

      expect(() => getDateRange('invalid')).toThrow('Invalid period');
    });
  });

  describe('Total Sales Calculation', () => {
    test('should calculate total sales for a period', async () => {
      const { getTotalSales } = await import('#services/analytics.service.js');

      const mockResult = [
        { total: '10000.00', count: 10 },
      ];

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockResult),
        }),
      });

      const result = await getTotalSales(1, '2026-01-01', '2026-01-31');

      expect(result.totalRevenue).toBe(10000);
      expect(result.transactionCount).toBe(10);
      expect(result.avgTransaction).toBe(1000);
    });

    test('should return zeros for no sales', async () => {
      const { getTotalSales } = await import('#services/analytics.service.js');

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await getTotalSales(1, '2026-01-01', '2026-01-31');

      expect(result.totalRevenue).toBe(0);
      expect(result.transactionCount).toBe(0);
      expect(result.avgTransaction).toBe(0);
    });
  });

  describe('Profit Calculation', () => {
    test('should calculate total profit', async () => {
      const { getTotalProfit } = await import('#services/analytics.service.js');

      const mockResult = [
        { total: '3000.00' },
      ];

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockResult),
        }),
      });

      const profit = await getTotalProfit(1, '2026-01-01', '2026-01-31');

      expect(profit).toBe(3000);
    });

    test('should calculate profit margin correctly', async () => {
      const { getProfitMargin } = await import('#services/analytics.service.js');

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ total: '10000', count: 10 }]),
        }),
      });

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ total: '3000' }]),
        }),
      });

      const margin = await getProfitMargin(1, '2026-01-01', '2026-01-31');

      expect(margin).toBe(30);
    });

    test('should return 0 margin when no revenue', async () => {
      const { getProfitMargin } = await import('#services/analytics.service.js');

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ total: '0', count: 0 }]),
        }),
      });

      const margin = await getProfitMargin(1, '2026-01-01', '2026-01-31');

      expect(margin).toBe(0);
    });
  });

});

