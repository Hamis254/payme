jest.mock('#services/notification.service.js', () => ({
  notificationService: {
    createNotification: jest.fn(async input => ({
      id: 8,
      ...input,
      created_at: new Date('2026-10-28T05:00:00.000Z'),
    })),
  },
}));

jest.mock('#config/socket.js', () => ({
  broadcastNotification: jest.fn(),
  emitToBusiness: jest.fn(),
}));

jest.mock('#services/pushNotification.service.js', () => ({
  sendPushNotification: jest.fn(() => Promise.resolve()),
}));

import { notificationService as service } from '#services/notification.service.js';
import { broadcastNotification } from '#config/socket.js';
import { sendPushNotification } from '#services/pushNotification.service.js';
import { emitNotification, notifications } from '../src/utils/notificationEmitter.js';

beforeEach(() => jest.clearAllMocks());

describe('transaction notification templates', () => {
  it.each([
    [
      notifications.creditSaleCreated({
        credit_sale_id: 11,
        amount: 125,
        customer_name: 'Customer',
        balance_remaining: 225,
        business_id: 7,
      }),
      'credit_sale_created',
      11,
      'credit_sale',
    ],
    [
      notifications.creditPaymentReceived({
        payment_id: 12,
        amount: 50,
        customer_name: 'Customer',
        credit_account_id: 4,
        balance_remaining: 175,
        business_id: 7,
      }),
      'credit_payment_received',
      12,
      'credit_payment',
    ],
    [
      notifications.hpAgreementCreated({
        agreement_id: 13,
        amount: 300,
        business_id: 7,
      }),
      'hp_agreement_created',
      13,
      'hire_purchase',
    ],
    [
      notifications.hpInstallmentReceived({
        payment_id: 14,
        agreement_id: 13,
        amount: 25,
        installment_number: 2,
        balance_remaining: 275,
        business_id: 7,
      }),
      'hp_installment_received',
      14,
      'hire_purchase_payment',
    ],
  ])('builds a %s notification with business-scoped metadata', (template, type, id, relatedType) => {
    expect(template).toMatchObject({
      type,
      related_id: id,
      related_type: relatedType,
      metadata: {
        business_id: 7,
        amount: expect.any(Number),
      },
    });
  });

  it('includes business_id in the personal socket notification payload', async () => {
    await emitNotification({
      user_id: 10,
      business_id: 7,
      ...notifications.creditPaymentReceived({
        payment_id: 12,
        amount: 50,
        customer_name: 'Customer',
        credit_account_id: 4,
        balance_remaining: 175,
        business_id: 7,
      }),
    });

    expect(service.createNotification).toHaveBeenCalledTimes(1);
    expect(broadcastNotification).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ business_id: 7 })
    );
  });

  it('schedules push delivery after persisting the notification', async () => {
    await emitNotification({
      user_id: 10,
      business_id: 7,
      ...notifications.creditPaymentReceived({
        payment_id: 12,
        amount: 50,
        customer_name: 'Customer',
        credit_account_id: 4,
        balance_remaining: 175,
        business_id: 7,
      }),
    });

    expect(service.createNotification).toHaveBeenCalledTimes(1);
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(sendPushNotification).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        notificationId: 8,
        type: 'credit_payment_received',
        businessId: 7,
      })
    );
    expect(service.createNotification.mock.invocationCallOrder[0]).toBeLessThan(
      sendPushNotification.mock.invocationCallOrder[0]
    );
    expect(broadcastNotification.mock.invocationCallOrder[0]).toBeLessThan(
      sendPushNotification.mock.invocationCallOrder[0]
    );
  });

  it('does not send a push when notification preferences suppress the notification', async () => {
    service.createNotification.mockResolvedValueOnce(null);

    await emitNotification({
      user_id: 10,
      business_id: 7,
      ...notifications.creditPaymentReceived({
        payment_id: 12,
        amount: 50,
        customer_name: 'Customer',
        credit_account_id: 4,
        balance_remaining: 175,
        business_id: 7,
      }),
    });

    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(broadcastNotification).not.toHaveBeenCalled();
  });
});
