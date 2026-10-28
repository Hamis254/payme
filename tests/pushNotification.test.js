jest.mock('#config/database.js', () => ({
  db: {
    select: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockMessaging = {
  sendEachForMulticast: jest.fn(),
};
const mockDeleteWhere = jest.fn().mockResolvedValue([]);

jest.mock('firebase-admin/app', () => ({
  cert: jest.fn(value => value),
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'test-app' })),
}));

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => mockMessaging),
}));

import { db } from '#config/database.js';
import { deviceTokens } from '#models/deviceToken.model.js';
import { sendPushNotification } from '#services/pushNotification.service.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const encodedServiceAccount = Buffer.from(
  JSON.stringify({
    project_id: 'test-project',
    client_email: 'test@example.com',
    private_key: 'test-key',
  })
).toString('base64');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = encodedServiceAccount;
  getApps.mockReturnValue([]);
  initializeApp.mockReturnValue({ name: 'test-app' });
  getMessaging.mockReturnValue(mockMessaging);
  db.select.mockReturnValue({
    from: () => ({
      where: jest.fn().mockResolvedValue([{ token: 'token-one' }]),
    }),
  });
  db.delete.mockReturnValue({
    where: mockDeleteWhere,
  });
});

afterEach(() => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
});

describe('sendPushNotification', () => {
  it('initializes Firebase Admin and sends the expected high-priority message', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValueOnce({
      responses: [{ success: true }],
    });

    await sendPushNotification(10, {
      notificationId: 55,
      type: 'credit_payment_received',
      title: 'Payment received',
      message: 'KES 50 paid',
      businessId: 7,
    });

    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(getMessaging).toHaveBeenCalledTimes(1);
    expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['token-one'],
      notification: { title: 'Payment received', body: 'KES 50 paid' },
      data: {
        notification_id: '55',
        type: 'credit_payment_received',
        business_id: '7',
      },
      android: {
        priority: 'high',
        notification: { channelId: 'payme_alerts' },
      },
    });
  });

  it('sends to all tokens in chunks no larger than Firebase multicast limit', async () => {
    const tokens = Array.from({ length: 501 }, (_, i) => ({
      token: `token-${i}`,
    }));
    db.select.mockReturnValue({
      from: () => ({
        where: jest.fn().mockResolvedValue(tokens),
      }),
    });
    mockMessaging.sendEachForMulticast
      .mockResolvedValueOnce({
        responses: Array.from({ length: 500 }, () => ({ success: true })),
      })
      .mockResolvedValueOnce({ responses: [{ success: true }] });

    await sendPushNotification(10, {
      notificationId: 55,
      type: 'sale_created',
      title: 'Sale',
      message: 'Sale complete',
      businessId: 7,
    });

    expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(mockMessaging.sendEachForMulticast.mock.calls[0][0].tokens).toHaveLength(
      500
    );
    expect(mockMessaging.sendEachForMulticast.mock.calls[1][0].tokens).toHaveLength(
      1
    );
  });

  it('deletes tokens that Firebase reports as unregistered', async () => {
    mockMessaging.sendEachForMulticast.mockResolvedValueOnce({
      responses: [
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
      ],
    });

    await sendPushNotification(10, {
      notificationId: 55,
      type: 'sale_created',
      title: 'Sale',
      message: 'Sale complete',
      businessId: 7,
    });

    expect(db.delete).toHaveBeenCalledWith(deviceTokens);
    expect(mockDeleteWhere).toHaveBeenCalledWith(expect.anything());
  });

  it('does not throw when Firebase delivery fails', async () => {
    mockMessaging.sendEachForMulticast.mockRejectedValueOnce(
      new Error('Firebase unavailable')
    );

    await expect(
      sendPushNotification(10, {
        notificationId: 55,
        type: 'sale_created',
        title: 'Sale',
        message: 'Sale complete',
        businessId: 7,
      })
    ).resolves.toBeUndefined();
  });
});
