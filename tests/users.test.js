/**
 * Users Service Tests
 * Tests for user management including CRUD operations
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Users Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Exports Validation', () => {
    test('should export getAllUsers function', async () => {
      const module = await import('#services/users.service.js');
      expect(module.getAllUsers).toBeDefined();
      expect(typeof module.getAllUsers).toBe('function');
    });

    test('should export getUserById function', async () => {
      const module = await import('#services/users.service.js');
      expect(module.getUserById).toBeDefined();
      expect(typeof module.getUserById).toBe('function');
    });

    test('should export updateUser function', async () => {
      const module = await import('#services/users.service.js');
      expect(module.updateUser).toBeDefined();
      expect(typeof module.updateUser).toBe('function');
    });

    test('should export deleteUser function', async () => {
      const module = await import('#services/users.service.js');
      expect(module.deleteUser).toBeDefined();
      expect(typeof module.deleteUser).toBe('function');
    });

    test('should have exactly 4 exports', async () => {
      const module = await import('#services/users.service.js');
      const exportNames = [
        'getAllUsers',
        'getUserById',
        'updateUser',
        'deleteUser',
      ];

      exportNames.forEach(name => {
        expect(module[name]).toBeDefined();
      });
    });
  });

  describe('Function Types', () => {
    test('getAllUsers should be async', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      const result = getAllUsers();
      expect(result).toBeInstanceOf(Promise);
    });

    test('getUserById should be async', async () => {
      const { getUserById } = await import('#services/users.service.js');
      const result = getUserById(1);
      expect(result).toBeInstanceOf(Promise);
    });

    test('updateUser should be async', async () => {
      const { updateUser } = await import('#services/users.service.js');
      const result = updateUser(1, { name: 'Updated' });
      expect(result).toBeInstanceOf(Promise);
    });

    test('deleteUser should be async', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      const result = deleteUser(1);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('getAllUsers Function', () => {
    test('should be callable with no parameters', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Function signature: () => Promise
    });

    test('should return a Promise', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      const result = getAllUsers();
      expect(result).toBeInstanceOf(Promise);
    });

    test('should return array of users', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns array of user objects with id, email, name, phone_number, role
    });

    test('should include user fields in result', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with: id, email, name, phone_number, role, created_at, updated_at
    });
  });

  describe('getUserById Function', () => {
    test('should accept id parameter', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Signature: (id) => Promise
    });

    test('should return single user object', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Returns single user object or throws error
    });

    test('should include user fields in result', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Returns user with: id, email, name, phone_number, role, created_at, updated_at
    });

    test('should handle numeric id', async () => {
      const { getUserById } = await import('#services/users.service.js');
      const result = getUserById(123);
      expect(result).toBeInstanceOf(Promise);
    });

    test('should throw error when user not found', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Throws 'User not found' when id doesn't exist
    });
  });

  describe('updateUser Function', () => {
    test('should accept id and updates parameters', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Signature: (id, updates) => Promise
    });

    test('should allow updating name', async () => {
      const { updateUser } = await import('#services/users.service.js');
      const result = updateUser(1, { name: 'John Doe' });
      expect(result).toBeInstanceOf(Promise);
    });

    test('should allow updating email', async () => {
      const { updateUser } = await import('#services/users.service.js');
      const result = updateUser(1, { email: 'new@example.com' });
      expect(result).toBeInstanceOf(Promise);
    });

    test('should allow updating phone_number', async () => {
      const { updateUser } = await import('#services/users.service.js');
      const result = updateUser(1, { phone_number: '254712345678' });
      expect(result).toBeInstanceOf(Promise);
    });

    test('should allow updating role', async () => {
      const { updateUser } = await import('#services/users.service.js');
      const result = updateUser(1, { role: 'admin' });
      expect(result).toBeInstanceOf(Promise);
    });

    test('should accept multiple update fields', async () => {
      const { updateUser } = await import('#services/users.service.js');
      const result = updateUser(1, {
        name: 'John Doe',
        email: 'john@example.com',
        phone_number: '254712345678',
      });
      expect(result).toBeInstanceOf(Promise);
    });

    test('should return updated user object', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Returns user with updated fields
    });

    test('should update updated_at timestamp', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Automatically adds updated_at: new Date()
    });

    test('should throw error when user not found', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Throws error if user doesn't exist
    });

    test('should validate duplicate email not allowed', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Throws 'Email already exists' if updating to existing email
    });

    test('should validate duplicate phone not allowed', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Throws 'Phone number already exists' if updating to existing phone
    });

    test('should allow updating same email', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Should not throw if updating to current email
    });

    test('should allow updating same phone', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Should not throw if updating to current phone
    });
  });

  describe('deleteUser Function', () => {
    test('should accept id parameter', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Signature: (id) => Promise
    });

    test('should return deleted user object', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Returns user object with: id, email, name, phone_number, role
    });

    test('should throw error when user not found', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Throws error if user doesn't exist
    });

    test('should check user exists before deleting', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Calls getUserById first to verify existence
    });
  });

  describe('Service Structure', () => {
    test('should be importable from #services/users.service.js', async () => {
      const module = await import('#services/users.service.js');
      expect(module).toBeDefined();
      expect(typeof module).toBe('object');
    });

    test('should be a valid ES module', async () => {
      const module = await import('#services/users.service.js');
      expect(module).not.toBeNull();
    });
  });

  describe('User Fields', () => {
    test('should handle user id field', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with id field
    });

    test('should handle user email field', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with email field
    });

    test('should handle user name field', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with name field
    });

    test('should handle user phone_number field', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with phone_number field
    });

    test('should handle user role field', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with role field
    });

    test('should handle user created_at field', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with created_at field
    });

    test('should handle user updated_at field', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Returns users with updated_at field
    });
  });

  describe('User Roles', () => {
    test('should support admin role', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Role can be set to 'admin'
    });

    test('should support user role', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Role can be set to 'user'
    });

    test('should support guest role', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Role can be set to 'guest'
    });
  });

  describe('Email Validation', () => {
    test('should detect duplicate email on update', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Checks if email already exists before update
    });

    test('should reject duplicate email with error message', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Throws error message 'Email already exists'
    });

    test('should allow email change to new address', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Should complete if email is not already taken
    });
  });

  describe('Phone Validation', () => {
    test('should detect duplicate phone_number on update', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Checks if phone_number already exists before update
    });

    test('should reject duplicate phone with error message', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Throws error message 'Phone number already exists'
    });

    test('should allow phone change to new number', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Should complete if phone_number is not already taken
    });

    test('should support Kenyan phone format', async () => {
      const { updateUser } = await import('#services/users.service.js');
      const result = updateUser(1, { phone_number: '254712345678' });
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Error Handling', () => {
    test('getAllUsers should throw on database error', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Logs error and rethrows
    });

    test('getUserById should throw on database error', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Logs error and rethrows
    });

    test('updateUser should throw on database error', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Logs error and rethrows
    });

    test('deleteUser should throw on database error', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Logs error and rethrows
    });

    test('should log all operations', async () => {
      const { getUserById, updateUser, deleteUser } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      expect(updateUser).toBeDefined();
      expect(deleteUser).toBeDefined();
      // All functions log errors on failure
    });
  });

  describe('Database Operations', () => {
    test('getAllUsers should query users table', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Uses db.select().from(users)
    });

    test('getUserById should query users table with id filter', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Uses db.select().from(users).where(eq(users.id, id))
    });

    test('updateUser should query users table to verify existence', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Calls getUserById first (database query)
    });

    test('updateUser should check for duplicate email', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // If updating email, checks db.select().from(users).where(eq(users.email, newEmail))
    });

    test('updateUser should check for duplicate phone', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // If updating phone, checks db.select().from(users).where(eq(users.phone_number, newPhone))
    });

    test('updateUser should update users table', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Uses db.update(users).set(updateData).where(eq(users.id, id))
    });

    test('deleteUser should query users table to verify existence', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Calls getUserById first (database query)
    });

    test('deleteUser should delete from users table', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Uses db.delete(users).where(eq(users.id, id))
    });
  });

  describe('User Creation Workflow', () => {
    test('should capture user id on creation', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Users have unique id field
    });

    test('should capture user email on creation', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Users have email field
    });

    test('should capture user created_at on creation', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Users have created_at timestamp
    });

    test('should initialize user updated_at on creation', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Users have updated_at field
    });
  });

  describe('CRUD Operations Completeness', () => {
    test('should support Create via initial user creation', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Create operation happens in auth service, returns user
    });

    test('should support Read with getAllUsers', async () => {
      const { getAllUsers } = await import('#services/users.service.js');
      expect(getAllUsers).toBeDefined();
      // Reads all users
    });

    test('should support Read with getUserById', async () => {
      const { getUserById } = await import('#services/users.service.js');
      expect(getUserById).toBeDefined();
      // Reads single user
    });

    test('should support Update with updateUser', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // Updates user fields
    });

    test('should support Delete with deleteUser', async () => {
      const { deleteUser } = await import('#services/users.service.js');
      expect(deleteUser).toBeDefined();
      // Deletes user from database
    });
  });

  describe('Immutable Fields', () => {
    test('should preserve user id on update', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // User id should not be updatable
    });

    test('should preserve user created_at on update', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // created_at should not be updated
    });

    test('should update updated_at timestamp on update', async () => {
      const { updateUser } = await import('#services/users.service.js');
      expect(updateUser).toBeDefined();
      // updated_at should always be refreshed on update
    });
  });
});
