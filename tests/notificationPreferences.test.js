import { notificationService } from '../src/services/notification.service.js';

describe('notification type preferences', () => {
  it('maps credit events to credit_notifications and HP events to sales_notifications', () => {
    const prefs = {
      credit_notifications: false,
      sales_notifications: false,
    };

    expect(
      notificationService._isNotificationTypeEnabled(
        'credit_sale_created',
        prefs
      )
    ).toBe(false);
    expect(
      notificationService._isNotificationTypeEnabled(
        'credit_payment_received',
        prefs
      )
    ).toBe(false);
    expect(
      notificationService._isNotificationTypeEnabled(
        'hp_agreement_created',
        prefs
      )
    ).toBe(false);
    expect(
      notificationService._isNotificationTypeEnabled(
        'hp_installment_received',
        prefs
      )
    ).toBe(false);
  });
});
