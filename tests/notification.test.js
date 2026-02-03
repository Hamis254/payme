/**
 * Notification Service Tests
 * Tests for notification creation and delivery
 */

jest.mock('#config/database.js');

jest.mock('drizzle-orm', () => ({
  eq: (a, b) => ({ type: 'eq', a, b }),
  and: (...args) => ({ type: 'and', args }),
}));

jest.mock('africastalking');
jest.mock('nodemailer');

describe('Notification Service', () => {
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
    db.from = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.set = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.returning = jest.fn().mockReturnThis();

    const notifModule = await import('#services/notification.service.js');
    service = notifModule.notificationService;
  });

  describe('Notification Creation', () => {
    test('should create a notification', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        phone_number: '+254712345678',
      };

      const mockNotification = {
        id: 1,
        user_id: 1,
        type: 'payment_complete',
        channel: 'in_app',
        title: 'Payment Received',
        message: 'Your payment has been processed',
        sent_at: new Date(),
      };

      const mockPrefs = {
        id: 1,
        user_id: 1,
        email_enabled: true,
        sms_enabled: true,
      };

      // Mock user lookup
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockUser]),
      });

      // Mock preferences lookup
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockPrefs]),
      });

      // Mock notification creation
      db.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValueOnce([mockNotification]),
      });

      const result = await service.createNotification({
        user_id: 1,
        type: 'payment_complete',
        channel: 'in_app',
        title: 'Payment Received',
        message: 'Your payment has been processed',
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('payment_complete');
    });

    test('should throw error when user not found', async () => {
      // Mock user not found
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([]),
      });

      await expect(
        service.createNotification({
          user_id: 999,
          type: 'payment_complete',
          channel: 'in_app',
          title: 'Payment Received',
          message: 'Your payment has been processed',
        })
      ).rejects.toThrow('User 999 not found');
    });
  });
});
