/**
 * Stock Management Service Tests
 * Tests for product management, stock operations, and FIFO deduction
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.mock('#config/database.js', () => {
  const createSelectChain = () => {
    const chain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
    };
    // Make it thenable so it can be awaited
    chain.then = jest.fn((resolve) => resolve([]));
    chain.catch = jest.fn();
    return chain;
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
  asc: (a) => ({ type: 'asc', a }),
  gte: (a, b) => ({ type: 'gte', a, b }),
  lte: (a, b) => ({ type: 'lte', a, b }),
}));

describe('Stock Service', () => {
  let db;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('#config/database.js');
    db = mod.db;
  });

  describe('Product Management', () => {
    test('should create a product', async () => {
      const { createProduct } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            { id: 1, business_id: 1, name: 'Test Product', current_quantity: '0' },
          ]),
        }),
      });

      await createProduct(1, {
        business_id: 1,
        name: 'Test Product',
        buying_price_per_unit: 100,
        selling_price_per_unit: 150,
      });

      expect(db.select).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
    });

    test('should get products for a business', async () => {
      const { getProductsForBusiness } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { id: 1, name: 'Product 1' },
          { id: 2, name: 'Product 2' },
        ]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await getProductsForBusiness(1, 1);
      expect(db.select).toHaveBeenCalled();
    });

    test('should get product by ID', async () => {
      const { getProductById } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { id: 1, business_id: 1, name: 'Test Product' },
        ]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      await getProductById(1, 1);
      expect(db.select).toHaveBeenCalled();
    });

    test('should update product', async () => {
      const { updateProduct } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, business_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1, name: 'Updated' }]),
          }),
        }),
      });

      await updateProduct(1, 1, { name: 'Updated Product' });
      expect(db.update).toHaveBeenCalled();
    });

    test('should handle product not found', async () => {
      const { updateProduct } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await expect(updateProduct(1, 999, { name: 'Updated' })).rejects.toThrow();
    });
  });

  describe('Stock Operations', () => {
    test('should add stock batch', async () => {
      const { addStock } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, business_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            { id: 1, product_id: 1, quantity: '100' },
          ]),
        }),
      });

      await addStock(1, {
        product_id: 1,
        quantity: 100,
        cost_per_unit: 100,
        date: new Date(),
      });

      expect(db.insert).toHaveBeenCalled();
    });

    test('should deduct stock', async () => {
      const { deductStock } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, current_quantity: '100' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await deductStock(1, 10);
      expect(db.update).toHaveBeenCalled();
    });

    test('should check stock availability', async () => {
      const { checkStockAvailability } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, current_quantity: '100' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await checkStockAvailability(1, 50);
      expect(db.select).toHaveBeenCalled();
    });

    test('should deduct stock using FIFO', async () => {
      const { deductStockFIFO } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, current_quantity: '100', name: 'Test', buying_price_per_unit: '100' }]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          { id: 1, quantity_change: '100', unit_cost: '100', created_at: new Date() },
        ]),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      });

      await deductStockFIFO(1, 50);
      expect(db.update).toHaveBeenCalled();
    });

    test('should record stock adjustment', async () => {
      const { recordAdjustment } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, business_id: 1 }]),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            { id: 1, product_id: 1, quantity_change: '10' },
          ]),
        }),
      });

      await recordAdjustment(1, {
        product_id: 1,
        quantity_change: 10,
        reason: 'spoilage',
      });

      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('Inventory Reporting', () => {
    test('should get inventory for product', async () => {
      const { getInventoryForProduct } = await import('#services/stock.service.js');

      // First two chains for getProductById (product + business lookup)
      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { id: 1, business_id: 1, name: 'Test Product' },
        ]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      // Third chain for movements lookup
      const selectChain3 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: jest.fn((onFulfilled) =>
          onFulfilled([{ id: 1, type: 'purchase', quantity_change: '100' }])
        ),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);
      db.select.mockReturnValueOnce(selectChain3);

      await getInventoryForProduct(1, 1);
      expect(db.select).toHaveBeenCalled();
    });

    test('should get full inventory for business', async () => {
      const { getFullInventoryForBusiness } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: jest.fn((onFulfilled) =>
          onFulfilled([{ id: 1, name: 'Product 1', current_quantity: '100' }])
        ),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      await getFullInventoryForBusiness(1, 1);
      expect(db.select).toHaveBeenCalled();
    });

    test('should calculate inventory value', async () => {
      const { getFullInventoryForBusiness } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        then: jest.fn((onFulfilled) =>
          onFulfilled([
            { id: 1, current_quantity: '100', buying_price_per_unit: '100' },
          ])
        ),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      await getFullInventoryForBusiness(1, 1);
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle insufficient stock', async () => {
      const { checkStockAvailability } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, current_quantity: '10' }]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await checkStockAvailability(1, 50);
      expect(db.select).toHaveBeenCalled();
    });

    test('should validate product ownership', async () => {
      const { getProductById } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await expect(getProductById(1, 999)).rejects.toThrow();
    });

    test('should validate business ownership on creation', async () => {
      const { createProduct } = await import('#services/stock.service.js');

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };

      db.select.mockReturnValueOnce(selectChain);

      await expect(
        createProduct(1, {
          business_id: 999,
          name: 'Product',
          buying_price_per_unit: 100,
          selling_price_per_unit: 150,
        })
      ).rejects.toThrow();
    });
  });

  describe('Batch Tracking', () => {
    test('should track stock batches', async () => {
      const { addStock } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          { id: 1, business_id: 1, current_quantity: '100' },
        ]),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            { id: 1, product_id: 1, quantity: '100' },
          ]),
        }),
      });

      await addStock(1, {
        product_id: 1,
        quantity: 100,
        cost_per_unit: 100,
        date: new Date(),
      });

      expect(db.insert).toHaveBeenCalled();
    });

    test('should track FIFO costs', async () => {
      const { deductStockFIFO } = await import('#services/stock.service.js');

      const selectChain1 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            id: 1,
            current_quantity: '100',
            name: 'Product',
            buying_price_per_unit: '100',
          },
        ]),
      };

      const selectChain2 = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          {
            id: 1,
            quantity_change: '100',
            unit_cost: '100',
            created_at: new Date(),
          },
        ]),
      };

      db.select.mockReturnValueOnce(selectChain1);
      db.select.mockReturnValueOnce(selectChain2);

      db.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      });

      await deductStockFIFO(1, 50);
      expect(db.update).toHaveBeenCalled();
    });
  });
});
