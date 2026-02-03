/**
 * Authentication Service Tests
 * Tests for password hashing, user creation, and authentication
 */

jest.mock('#config/database.js');
jest.mock('drizzle-orm', () => ({
  eq: (a, b) => ({ type: 'eq', a, b }),
  and: (...args) => ({ type: 'and', args }),
}));

jest.mock('bcrypt', () => {
  const passwordMap = new Map();
  return {
    hash: jest.fn(async (password) => {
      const hash = `hashed_${Math.random()}_${password}`;
      passwordMap.set(hash, password);
      return hash;
    }),
    compare: jest.fn(async (password, hash) => {
      const originalPassword = hash.split('_').pop();
      return password === originalPassword;
    }),
  };
});

describe('Authentication Service', () => {
  let db;
  let service;

  beforeEach(async () => {
    jest.clearAllMocks();
    const dbModule = await import('#config/database.js');
    db = dbModule.db;

    // Setup default mock behaviors for db
    db.select = jest.fn().mockReturnThis();
    db.insert = jest.fn().mockReturnThis();
    db.update = jest.fn().mockReturnThis();
    db.delete = jest.fn().mockReturnThis();
    db.from = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.set = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.returning = jest.fn().mockReturnThis();

    service = await import('#services/auth.service.js');
  });

  describe('Password Management', () => {
    test('should hash password', async () => {
      const password = 'testPassword123';
      const hashed = await service.hashPassword(password);

      expect(hashed).toBeDefined();
      expect(typeof hashed).toBe('string');
      expect(hashed).not.toBe(password); // Should be different from original
    });

    test('should compare password with hash', async () => {
      const password = 'testPassword123';
      const hashed = await service.hashPassword(password);
      const isMatch = await service.comparePassword(password, hashed);

      expect(isMatch).toBe(true);
    });

    test('should reject incorrect password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword';
      const hashed = await service.hashPassword(password);
      const isMatch = await service.comparePassword(wrongPassword, hashed);

      expect(isMatch).toBe(false);
    });
  });

  describe('User Creation', () => {
    test('should create a new user', async () => {
      const mockUser = {
        id: 1,
        name: 'Test User',
        email: 'test@example.com',
        phone_number: '+254712345678',
        role: 'user',
        password_hash: 'hashed_password',
      };

      // Mock user not exists check
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([]),
      });

      // Mock user creation
      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValueOnce([mockUser]),
      });

      const result = await service.createUser({
        name: 'Test User',
        email: 'test@example.com',
        phone_number: '+254712345678',
        password: 'password123',
      });

      expect(result).toBeDefined();
      expect(result.email).toBe('test@example.com');
    });

    test('should reject duplicate email', async () => {
      const existingUser = { id: 1, email: 'existing@example.com' };

      // Mock user already exists
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([existingUser]),
      });

      await expect(
        service.createUser({
          name: 'Test User',
          email: 'existing@example.com',
          phone_number: '+254712345678',
          password: 'password123',
        })
      ).rejects.toThrow('User with this email already exists');
    });
  });

  describe('User Authentication', () => {
    test('should reject non-existent user', async () => {
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([]),
      });

      await expect(
        service.authenticateUser({
          email: 'nonexistent@example.com',
          password: 'password123',
        })
      ).rejects.toThrow('User not found');
    });
  });
});
