/**
 * Customer Service Tests
 * Tests for customer management, loyalty, and purchase tracking
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
  or: (...args) => ({ type: 'or', args }),
  like: (a, b) => ({ type: 'like', a, b }),
  desc: (a) => ({ type: 'desc', a }),
  asc: (a) => ({ type: 'asc', a }),
}));

describe('Customer Service', () => {
  let db;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('#config/database.js');
    db = mod.db;
  });

  describe('Customer Creation', () => {
    test('should create a new customer', async () => {
      const { createCustomer } = await import('#services/customer.service.js');

      const mockCustomer = {
        id: 1,
        business_id: 1,
        name: 'John Doe',
        phone: '+254712345678',
        email: 'john@example.com',
        customer_type: 'walk_in',
      };

      db.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockCustomer]),
        }),
      });

      const customer = await createCustomer(1, {
        name: 'John Doe',
        phone: '+254712345678',
        email: 'john@example.com',
      });

      expect(customer).toBeDefined();
      expect(customer.name).toBe('John Doe');
      expect(customer.phone).toBe('+254712345678');
    });
  });

  describe('Customer Retrieval', () => {
    test('should get customer by ID', async () => {
      const { getCustomer } = await import('#services/customer.service.js');

      const mockCustomer = {
        id: 1,
        business_id: 1,
        name: 'John Doe',
        phone: '+254712345678',
      };

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockCustomer]),
          }),
        }),
      });

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ average_spend: 500 }]),
          }),
        }),
      });

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ total_purchases: 10 }]),
          }),
        }),
      });

      const customer = await getCustomer(1, 1);

      expect(customer).toBeDefined();
      expect(customer.name).toBe('John Doe');
    });
  });

  describe('Customer Search', () => {
    test('should search customers by name', async () => {
      const { searchCustomers } = await import('#services/customer.service.js');

      const mockCustomers = [
        { id: 1, name: 'John Doe', phone: '+254712345678' },
        { id: 2, name: 'John Smith', phone: '+254798765432' },
      ];
      
      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(mockCustomers),
          }),
        }),
      });

      const customers = await searchCustomers(1, 'John');

      expect(customers).toHaveLength(2);
    });
  });
});
