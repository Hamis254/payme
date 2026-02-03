/**
 * Wallet Service Tests
 * Tests for token wallet, purchases, and transactions
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
  desc: (a) => ({ type: 'desc', a }),
  sum: (a) => ({ type: 'sum', a }),
}));

jest.mock('#utils/mpesa.js', () => ({
  initiateTokenPurchase: jest.fn(),
}));

describe('Wallet Service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
  });

  describe('Token Packages', () => {
    test('should return available token packages', async () => {
      const { getTokenPackages } = await import('#services/wallet.service.js');

      const packages = getTokenPackages();

      expect(packages).toBeDefined();
      expect(Array.isArray(packages)).toBe(true);
      expect(packages.length).toBeGreaterThan(0);
    });

    test('should calculate correct savings for packages', async () => {
      const { getTokenPackages } = await import('#services/wallet.service.js');

      const packages = getTokenPackages();

      packages.forEach(pkg => {
        const expectedPrice = pkg.tokens * 2;
        const savings = expectedPrice - pkg.price;
        expect(savings).toBeGreaterThan(0);
      });
    });

    test('should apply percentage discount correctly', async () => {
      const { calculatePackagePrice } = await import('#services/wallet.service.js');

      const price = calculatePackagePrice(30);
      expect(price).toBe(50);
    });
  });

  describe('Token Packages Configuration', () => {
    test('should have correct token package pricing', async () => {
      const { TOKEN_PACKAGES } = await import('#services/wallet.service.js');

      expect(TOKEN_PACKAGES).toBeDefined();
      expect(TOKEN_PACKAGES[0].tokens).toBe(30);
      expect(TOKEN_PACKAGES[0].price).toBe(50);
    });

    test('should have increasing discount for larger packages', async () => {
      const { TOKEN_PACKAGES } = await import('#services/wallet.service.js');

      const discounts = TOKEN_PACKAGES.map(pkg => pkg.savings);

      for (let i = 1; i < discounts.length; i++) {
        expect(discounts[i]).toBeGreaterThanOrEqual(discounts[i - 1]);
      }
    });
  });
});
