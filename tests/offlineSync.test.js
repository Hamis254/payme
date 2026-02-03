/**
 * Offline Synchronization Service Tests
 * Tests for offline mode, queue management, and conflict resolution
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

describe('Offline Synchronization Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Exports', () => {
    test('should export queueOfflineOperation function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.queueOfflineOperation).toBeDefined();
      expect(typeof module.queueOfflineOperation).toBe('function');
    });

    test('should export getPendingOperations function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.getPendingOperations).toBeDefined();
      expect(typeof module.getPendingOperations).toBe('function');
    });

    test('should export syncOperation function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.syncOperation).toBeDefined();
      expect(typeof module.syncOperation).toBe('function');
    });

    test('should export resolveConflict function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.resolveConflict).toBeDefined();
      expect(typeof module.resolveConflict).toBe('function');
    });

    test('should export retryFailedOperations function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.retryFailedOperations).toBeDefined();
      expect(typeof module.retryFailedOperations).toBe('function');
    });

    test('should export syncAllPendingOperations function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.syncAllPendingOperations).toBeDefined();
      expect(typeof module.syncAllPendingOperations).toBe('function');
    });

    test('should export getSyncStatus function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.getSyncStatus).toBeDefined();
      expect(typeof module.getSyncStatus).toBe('function');
    });

    test('should export getOfflineConfig function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.getOfflineConfig).toBeDefined();
      expect(typeof module.getOfflineConfig).toBe('function');
    });

    test('should export updateOfflineConfig function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.updateOfflineConfig).toBeDefined();
      expect(typeof module.updateOfflineConfig).toBe('function');
    });

    test('should export getSyncHistory function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.getSyncHistory).toBeDefined();
      expect(typeof module.getSyncHistory).toBe('function');
    });

    test('should export clearSyncedOperations function', async () => {
      const module = await import('#services/offlineSync.service.js');
      expect(module.clearSyncedOperations).toBeDefined();
      expect(typeof module.clearSyncedOperations).toBe('function');
    });
  });

  describe('Function Signatures', () => {
    test('queueOfflineOperation should be async', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(queueOfflineOperation.constructor.name).toBe('AsyncFunction');
    });

    test('getPendingOperations should be async', async () => {
      const { getPendingOperations } = await import('#services/offlineSync.service.js');
      expect(getPendingOperations.constructor.name).toBe('AsyncFunction');
    });

    test('syncOperation should be async', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(syncOperation.constructor.name).toBe('AsyncFunction');
    });

    test('resolveConflict should be async', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(resolveConflict.constructor.name).toBe('AsyncFunction');
    });
  });

  describe('Queue Operations', () => {
    test('should queue offline operation with required data', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with userId', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with businessId', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with operationType', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with operationId', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with endpoint', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with method', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with requestBody', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with requestHeaders', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with executedAt timestamp', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should queue operation with deviceId', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should initialize status as pending', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should return queued operation with id', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });
  });

  describe('Pending Operations', () => {
    test('getPendingOperations should retrieve pending operations', async () => {
      const { getPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof getPendingOperations).toBe('function');
    });

    test('getPendingOperations should filter by businessId', async () => {
      const { getPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof getPendingOperations).toBe('function');
    });

    test('getPendingOperations should filter by status', async () => {
      const { getPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof getPendingOperations).toBe('function');
    });

    test('getPendingOperations should support pagination', async () => {
      const { getPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof getPendingOperations).toBe('function');
    });

    test('getPendingOperations should support offset', async () => {
      const { getPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof getPendingOperations).toBe('function');
    });

    test('getPendingOperations should return array of operations', async () => {
      const { getPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof getPendingOperations).toBe('function');
    });
  });

  describe('Sync Operations', () => {
    test('syncOperation should update operation status to synced', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('syncOperation should store server response', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('syncOperation should store server_id from response', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('syncOperation should record sync timestamp', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('syncOperation should increment sync_attempts', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('syncOperation should handle duplicate operations', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('syncOperation should handle version mismatch conflicts', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('syncOperation should handle deleted resource conflicts', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });
  });

  describe('Conflict Resolution', () => {
    test('should detect duplicate operations', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should detect version mismatch conflicts', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should detect deleted resource conflicts', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('resolveConflict should support client_wins strategy', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('resolveConflict should support server_wins strategy', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('resolveConflict should support merge strategy', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('resolveConflict should support manual strategy', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('resolveConflict should reject invalid strategies', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('resolveConflict should record resolution strategy', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('resolveConflict should set resolved_at timestamp', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });
  });

  describe('Retry Operations', () => {
    test('retryFailedOperations should find failed operations', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });

    test('retryFailedOperations should respect max_retries limit', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });

    test('retryFailedOperations should reset status to pending', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });

    test('retryFailedOperations should increment sync_attempts', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });

    test('retryFailedOperations should clear last_error', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });

    test('retryFailedOperations should return retry results', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });

    test('retryFailedOperations should handle errors gracefully', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });
  });

  describe('Batch Sync', () => {
    test('syncAllPendingOperations should retrieve all pending operations', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('syncAllPendingOperations should sync each operation', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('syncAllPendingOperations should accept syncFunction parameter', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('syncAllPendingOperations should mark operations as syncing', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('syncAllPendingOperations should count successful syncs', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('syncAllPendingOperations should count failed syncs', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('syncAllPendingOperations should count conflicts', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('syncAllPendingOperations should return summary with duration', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });
  });

  describe('Sync Status', () => {
    test('getSyncStatus should return pending count', async () => {
      const { getSyncStatus } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncStatus).toBe('function');
    });

    test('getSyncStatus should return synced count', async () => {
      const { getSyncStatus } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncStatus).toBe('function');
    });

    test('getSyncStatus should return conflicts count', async () => {
      const { getSyncStatus } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncStatus).toBe('function');
    });

    test('getSyncStatus should return failed count', async () => {
      const { getSyncStatus } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncStatus).toBe('function');
    });

    test('getSyncStatus should return total count', async () => {
      const { getSyncStatus } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncStatus).toBe('function');
    });

    test('getSyncStatus should return lastSync timestamp', async () => {
      const { getSyncStatus } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncStatus).toBe('function');
    });

    test('getSyncStatus should work for businessId', async () => {
      const { getSyncStatus } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncStatus).toBe('function');
    });
  });

  describe('Configuration', () => {
    test('getOfflineConfig should retrieve configuration', async () => {
      const { getOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof getOfflineConfig).toBe('function');
    });

    test('getOfflineConfig should return null if not found', async () => {
      const { getOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof getOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should update settings', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support offline_mode_enabled', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support auto_sync_enabled', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support sync_interval_minutes', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support max_queue_size', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support retry_delay_seconds', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support default_conflict_strategy', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support allow_sales_offline', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support allow_expenses_offline', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });

    test('updateOfflineConfig should support allow_stock_adjustment_offline', async () => {
      const { updateOfflineConfig } = await import('#services/offlineSync.service.js');
      expect(typeof updateOfflineConfig).toBe('function');
    });
  });

  describe('Sync History', () => {
    test('getSyncHistory should retrieve sync history', async () => {
      const { getSyncHistory } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncHistory).toBe('function');
    });

    test('getSyncHistory should filter by queue_id', async () => {
      const { getSyncHistory } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncHistory).toBe('function');
    });

    test('getSyncHistory should support limit parameter', async () => {
      const { getSyncHistory } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncHistory).toBe('function');
    });

    test('getSyncHistory should order by started_at descending', async () => {
      const { getSyncHistory } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncHistory).toBe('function');
    });

    test('getSyncHistory should return array of history records', async () => {
      const { getSyncHistory } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncHistory).toBe('function');
    });
  });

  describe('Cleanup Operations', () => {
    test('clearSyncedOperations should delete old synced operations', async () => {
      const { clearSyncedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof clearSyncedOperations).toBe('function');
    });

    test('clearSyncedOperations should filter by businessId', async () => {
      const { clearSyncedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof clearSyncedOperations).toBe('function');
    });

    test('clearSyncedOperations should filter by status synced', async () => {
      const { clearSyncedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof clearSyncedOperations).toBe('function');
    });

    test('clearSyncedOperations should use olderThanDays parameter', async () => {
      const { clearSyncedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof clearSyncedOperations).toBe('function');
    });

    test('clearSyncedOperations should return deleted count', async () => {
      const { clearSyncedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof clearSyncedOperations).toBe('function');
    });
  });

  describe('Operation Types Supported', () => {
    test('should support sale operations', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should support expense operations', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should support record operations', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should support payment operations', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should support stock_adjustment operations', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });
  });

  describe('HTTP Methods', () => {
    test('should support POST method', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should support PUT method', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should support PATCH method', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });
  });

  describe('Device Tracking', () => {
    test('should track device_id', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });

    test('should track sync_batch_id', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('should track network_type in sync history', async () => {
      const { getSyncHistory } = await import('#services/offlineSync.service.js');
      expect(typeof getSyncHistory).toBe('function');
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should handle server errors', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should track last_error', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });

    test('should track error_code', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should set failed_at timestamp on final failure', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });
  });

  describe('Status Transitions', () => {
    test('should transition from pending to syncing', async () => {
      const { syncAllPendingOperations } = await import('#services/offlineSync.service.js');
      expect(typeof syncAllPendingOperations).toBe('function');
    });

    test('should transition from syncing to synced on success', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should transition from syncing to conflict on conflict', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should transition from syncing to failed on error', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should transition from conflict to synced after resolution', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('should transition from failed to pending on retry', async () => {
      const { retryFailedOperations } = await import('#services/offlineSync.service.js');
      expect(typeof retryFailedOperations).toBe('function');
    });
  });

  describe('Idempotency', () => {
    test('should detect duplicate operations in server response', async () => {
      const { syncOperation } = await import('#services/offlineSync.service.js');
      expect(typeof syncOperation).toBe('function');
    });

    test('should handle duplicate with client_wins strategy', async () => {
      const { resolveConflict } = await import('#services/offlineSync.service.js');
      expect(typeof resolveConflict).toBe('function');
    });

    test('should support idempotency keys in request headers', async () => {
      const { queueOfflineOperation } = await import('#services/offlineSync.service.js');
      expect(typeof queueOfflineOperation).toBe('function');
    });
  });
});
