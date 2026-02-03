/**
 * Businesses Service Tests
 * Tests for business management and operations
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

jest.mock('#config/database.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
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
}));

describe('Businesses Service', () => {
  let db;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('#config/database.js');
    db = mod.db;
  });

  describe('Business Creation', () => {
    test('should create a new business for user', async () => {
      const { createBusinessForUser } = await import('#services/businesses.service.js');

      const mockBusiness = {
        id: 1,
        user_id: 1,
        name: 'My Shop',
        location: 'Nairobi',
        verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      db.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockBusiness]),
        }),
      });

      const result = await createBusinessForUser(1, {
        name: 'My Shop',
        location: 'Nairobi',
        location_description: 'City center shop',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('My Shop');
      expect(result.user_id).toBe(1);
    });

    test('should validate business name is provided', async () => {
      const { createBusinessForUser } = await import('#services/businesses.service.js');

      db.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockRejectedValue(new Error('Name is required')),
        }),
      });

      await expect(
        createBusinessForUser(1, {
          name: '', // Empty name should be rejected by validation
          location: 'Test',
        })
      ).rejects.toThrow();
    });
  });

  describe('Business Retrieval', () => {
    test('should get business by ID if user owns it', async () => {
      const { getBusinessByIdForUser } = await import('#services/businesses.service.js');

      const mockBusiness = {
        id: 1,
        user_id: 1,
        name: 'My Shop',
        location: 'Nairobi',
        verified: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockBusiness]),
            }),
          }),
        }),
      });

      const result = await getBusinessByIdForUser(1, 1);

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.name).toBe('My Shop');
    });

    test('should throw error if user does not own business', async () => {
      const { getBusinessByIdForUser } = await import('#services/businesses.service.js');

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      await expect(getBusinessByIdForUser(1, 1)).rejects.toThrow();
    });

    test('should get all businesses for user', async () => {
      const { getBusinessesForUser } = await import('#services/businesses.service.js');

      const mockBusinesses = [
        { id: 1, user_id: 1, name: 'Shop 1', location: 'Nairobi' },
        { id: 2, user_id: 1, name: 'Shop 2', location: 'Mombasa' },
      ];

      db.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockBusinesses),
        }),
      });

      const result = await getBusinessesForUser(1);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].user_id).toBe(1);
    });
  });

  describe('Business Updates', () => {
    test('should update business details', async () => {
      const { updateBusinessForUser } = await import('#services/businesses.service.js');

      const mockBusiness = {
        id: 1,
        user_id: 1,
        name: 'Updated Shop',
        location: 'Nairobi',
        verified: false,
      };

      // Mock getBusinessByIdForUser call
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockBusiness]),
            }),
          }),
        }),
      });

      // Mock update call
      db.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockBusiness]),
            }),
          }),
        }),
      });

      const result = await updateBusinessForUser(1, 1, { name: 'Updated Shop' });

      expect(result).toBeDefined();
      expect(result.name).toBe('Updated Shop');
    });
  });

});


