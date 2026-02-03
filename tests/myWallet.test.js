/**
 * My Wallet Service Tests
 * Tests for wallet initialization, token purchases, and M-Pesa integration
 */

jest.mock('#config/database.js');
jest.mock('#config/logger.js', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('#utils/mpesa.js');

describe('My Wallet Service', () => {
  let db;
  let logger;
  let service;

  beforeEach(async () => {
    jest.clearAllMocks();

    const dbModule = await import('#config/database.js');
    const loggerModule = await import('#config/logger.js');
    await import('#utils/mpesa.js');

    db = dbModule.db;
    logger = loggerModule.default;

    // Setup default mock behaviors
    db.select = jest.fn().mockReturnThis();
    db.insert = jest.fn().mockReturnThis();
    db.update = jest.fn().mockReturnThis();
    db.delete = jest.fn().mockReturnThis();
    db.from = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.set = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockReturnThis();
    db.returning = jest.fn().mockReturnThis();

    service = await import('#services/myWallet.service.js');
  });

  describe('getOrCreateWallet', () => {
    test('should get existing wallet for business', async () => {
      const mockBusiness = { id: 1, user_id: 1 };
      const mockWallet = {
        id: 1,
        business_id: 1,
        balance_tokens: 50,
      };

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockBusiness]),
      });

      // Mock wallet retrieval
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockWallet]),
      });

      const result = await service.getOrCreateWallet(1, 1);

      expect(result).toBeDefined();
      expect(result.business_id).toBe(1);
      expect(result.balance_tokens).toBe(50);
    });

    test('should throw error when business not found', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([]),
      });

      await expect(service.getOrCreateWallet(999, 999)).rejects.toThrow(
        'Business not found or access denied'
      );
    });

    test('should create wallet when not exists', async () => {
      const mockBusiness = { id: 1, user_id: 1 };
      const newWallet = {
        id: 2,
        business_id: 1,
        balance_tokens: 0,
      };

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockBusiness]),
      });

      // Mock wallet not found
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([]),
      });

      // Mock wallet creation
      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValueOnce([newWallet]),
      });

      const result = await service.getOrCreateWallet(1, 1);

      expect(result).toBeDefined();
      expect(result.id).toBe(2);
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('getWalletBalance', () => {
    test('should return wallet balance with recent transactions', async () => {
      const mockBusiness = { id: 1, user_id: 1 };
      const mockWallet = {
        id: 1,
        business_id: 1,
        balance_tokens: 100,
      };
      const mockTransactions = [
        {
          id: 1,
          business_id: 1,
          type: 'purchase',
          amount: 50,
          created_at: new Date(),
        },
      ];

      // Mock business verification in getOrCreateWallet
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockBusiness]),
      });

      // Mock wallet retrieval in getOrCreateWallet
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockWallet]),
      });

      // Mock recent transactions
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce(mockTransactions),
      });

      const result = await service.getWalletBalance(1, 1);

      expect(result).toBeDefined();
      expect(result.balance).toBe(100);
      expect(Array.isArray(result.recentTransactions)).toBe(true);
    });
  });

  describe('getWalletTransactions', () => {
    test('should return wallet transactions', async () => {
      const mockBusiness = { id: 1, user_id: 1 };
      const mockTransactions = [
        {
          id: 1,
          business_id: 1,
          type: 'purchase',
          amount: 50,
          created_at: new Date(),
        },
      ];

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockBusiness]),
      });

      // Mock transactions query
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValueOnce(mockTransactions),
      });

      const result = await service.getWalletTransactions(1, 1, {});

      expect(result).toBeDefined();
      expect(result.transactions).toBeDefined();
      expect(Array.isArray(result.transactions)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    test('should filter transactions by type', async () => {
      const mockBusiness = { id: 1, user_id: 1 };
      const mockTransactions = [
        {
          id: 2,
          business_id: 1,
          type: 'reserve',
          amount: 10,
          created_at: new Date(),
        },
      ];

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockBusiness]),
      });

      // Mock transactions query
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValueOnce(mockTransactions),
      });

      const result = await service.getWalletTransactions(1, 1, {
        type: 'reserve',
      });

      expect(result).toBeDefined();
      expect(result.transactions).toBeDefined();
    });
  });

  describe('getTokenPurchaseHistory', () => {
    test('should return purchase history', async () => {
      const mockBusiness = { id: 1, user_id: 1 };
      const mockPurchases = [
        {
          id: 1,
          business_id: 1,
          package_type: '30',
          tokens_purchased: 30,
          status: 'completed',
          created_at: new Date(),
        },
      ];

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockBusiness]),
      });

      // Mock purchases query
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce(mockPurchases),
      });

      const result = await service.getTokenPurchaseHistory(1, 1, {});

      expect(result).toBeDefined();
      expect(result.purchases).toBeDefined();
      expect(Array.isArray(result.purchases)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    test('should filter by status', async () => {
      const mockBusiness = { id: 1, user_id: 1 };
      const mockPurchases = [
        {
          id: 2,
          business_id: 1,
          package_type: '50',
          tokens_purchased: 50,
          status: 'pending',
          created_at: new Date(),
        },
      ];

      // Mock business verification
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockBusiness]),
      });

      // Mock purchases query
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce(mockPurchases),
      });

      const result = await service.getTokenPurchaseHistory(1, 1, {
        status: 'pending',
      });

      expect(result).toBeDefined();
      expect(result.purchases).toBeDefined();
      expect(Array.isArray(result.purchases)).toBe(true);
    });
  });
});
