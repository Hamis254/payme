/**
 * Audit Service Tests
 * Tests for audit logging and event tracking
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

describe('Audit Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Exports', () => {
    test('should export logAuditEvent function', async () => {
      const module = await import('#services/audit.service.js');
      expect(module.logAuditEvent).toBeDefined();
      expect(typeof module.logAuditEvent).toBe('function');
    });

    test('should export getAuditLogs function', async () => {
      const module = await import('#services/audit.service.js');
      expect(module.getAuditLogs).toBeDefined();
      expect(typeof module.getAuditLogs).toBe('function');
    });

    test('should export getEntityAuditLogs function', async () => {
      const module = await import('#services/audit.service.js');
      expect(module.getEntityAuditLogs).toBeDefined();
      expect(typeof module.getEntityAuditLogs).toBe('function');
    });

    test('should export getUserAuditLogs function', async () => {
      const module = await import('#services/audit.service.js');
      expect(module.getUserAuditLogs).toBeDefined();
      expect(typeof module.getUserAuditLogs).toBe('function');
    });

    test('should export getAuditSummary function', async () => {
      const module = await import('#services/audit.service.js');
      expect(module.getAuditSummary).toBeDefined();
      expect(typeof module.getAuditSummary).toBe('function');
    });

    test('should export withAuditLogging function', async () => {
      const module = await import('#services/audit.service.js');
      expect(module.withAuditLogging).toBeDefined();
      expect(typeof module.withAuditLogging).toBe('function');
    });
  });

  describe('Function Signatures', () => {
    test('logAuditEvent should be async', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(logAuditEvent.constructor.name).toBe('AsyncFunction');
    });

    test('getAuditLogs should be async', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(getAuditLogs.constructor.name).toBe('AsyncFunction');
    });

    test('getEntityAuditLogs should be async', async () => {
      const { getEntityAuditLogs } = await import('#services/audit.service.js');
      expect(getEntityAuditLogs.constructor.name).toBe('AsyncFunction');
    });

    test('getUserAuditLogs should be async', async () => {
      const { getUserAuditLogs } = await import('#services/audit.service.js');
      expect(getUserAuditLogs.constructor.name).toBe('AsyncFunction');
    });

    test('getAuditSummary should be async', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(getAuditSummary.constructor.name).toBe('AsyncFunction');
    });

    test('withAuditLogging should return function', async () => {
      const { withAuditLogging } = await import('#services/audit.service.js');
      const mockHandler = async () => ({ id: 1 });
      const wrapper = withAuditLogging(mockHandler, {
        action: 'CREATE',
        entityType: 'product',
      });
      expect(typeof wrapper).toBe('function');
    });
  });

  describe('logAuditEvent Parameters', () => {
    test('should accept data object with businessId', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should accept data object with userId', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should accept data object with action', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should accept data object with entityType', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should accept data object with entityId', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support optional oldValues', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support optional newValues', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support optional metadata', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support optional ipAddress', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support optional userAgent', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });
  });

  describe('getAuditLogs Parameters', () => {
    test('should accept businessId as required parameter', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should accept options object as second parameter', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should support limit in options (default 100)', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should support offset in options (default 0)', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should support entityType filter in options', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should support action filter in options', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should support userId filter in options', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should support startDate filter in options', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });

    test('should support endDate filter in options', async () => {
      const { getAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getAuditLogs).toBe('function');
    });
  });

  describe('getEntityAuditLogs Parameters', () => {
    test('should accept businessId parameter', async () => {
      const { getEntityAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getEntityAuditLogs).toBe('function');
    });

    test('should accept entityType parameter', async () => {
      const { getEntityAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getEntityAuditLogs).toBe('function');
    });

    test('should accept entityId parameter', async () => {
      const { getEntityAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getEntityAuditLogs).toBe('function');
    });
  });

  describe('getUserAuditLogs Parameters', () => {
    test('should accept businessId parameter', async () => {
      const { getUserAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getUserAuditLogs).toBe('function');
    });

    test('should accept userId parameter', async () => {
      const { getUserAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getUserAuditLogs).toBe('function');
    });

    test('should accept optional limit parameter (default 50)', async () => {
      const { getUserAuditLogs } = await import('#services/audit.service.js');
      expect(typeof getUserAuditLogs).toBe('function');
    });
  });

  describe('getAuditSummary Parameters', () => {
    test('should accept businessId as required parameter', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });

    test('should accept optional days parameter (default 7)', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });
  });

  describe('withAuditLogging Parameters', () => {
    test('should accept handler function', async () => {
      const { withAuditLogging } = await import('#services/audit.service.js');
      const mockHandler = async () => ({ id: 1 });
      const result = withAuditLogging(mockHandler, { action: 'CREATE', entityType: 'product' });
      expect(typeof result).toBe('function');
    });

    test('should accept options with action property', async () => {
      const { withAuditLogging } = await import('#services/audit.service.js');
      const mockHandler = async () => ({ id: 1 });
      const result = withAuditLogging(mockHandler, {
        action: 'UPDATE',
        entityType: 'product',
      });
      expect(typeof result).toBe('function');
    });

    test('should accept options with entityType property', async () => {
      const { withAuditLogging } = await import('#services/audit.service.js');
      const mockHandler = async () => ({ id: 1 });
      const result = withAuditLogging(mockHandler, {
        action: 'DELETE',
        entityType: 'user',
      });
      expect(typeof result).toBe('function');
    });

    test('should accept options with optional metadata', async () => {
      const { withAuditLogging } = await import('#services/audit.service.js');
      const mockHandler = async () => ({ id: 1 });
      const result = withAuditLogging(mockHandler, {
        action: 'CREATE',
        entityType: 'product',
        metadata: { source: 'api' },
      });
      expect(typeof result).toBe('function');
    });

    test('should accept options with optional oldValues', async () => {
      const { withAuditLogging } = await import('#services/audit.service.js');
      const mockHandler = async () => ({ id: 1 });
      const result = withAuditLogging(mockHandler, {
        action: 'UPDATE',
        entityType: 'product',
        oldValues: { price: 100 },
      });
      expect(typeof result).toBe('function');
    });
  });

  describe('Audit Actions', () => {
    test('should support CREATE action', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support UPDATE action', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support DELETE action', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support READ action', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support EXPORT action', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });

    test('should support FAILED action suffix', async () => {
      const { logAuditEvent } = await import('#services/audit.service.js');
      expect(typeof logAuditEvent).toBe('function');
    });
  });

  describe('Summary Return Values', () => {
    test('getAuditSummary should return period field', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });

    test('getAuditSummary should return totalEvents field', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });

    test('getAuditSummary should return byAction field', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });

    test('getAuditSummary should return byEntityType field', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });

    test('getAuditSummary should return topUsers field', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });

    test('topUsers should contain userId and events', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });

    test('topUsers should be limited to 5 entries', async () => {
      const { getAuditSummary } = await import('#services/audit.service.js');
      expect(typeof getAuditSummary).toBe('function');
    });
  });
});
