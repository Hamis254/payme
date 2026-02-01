# 🔔 Real-Time Notifications System - Complete Implementation

## ✅ What's Been Built

A **production-ready real-time notification system** with:

### 📊 3 Channels
1. **In-App** - WebSocket via Socket.io (real-time)
2. **SMS** - Via AfricasTalking (Kenya-focused)
3. **Email** - Via Nodemailer

### 💾 Database Tables
- `notifications` - All notifications (18 columns)
- `notification_preferences` - User opt-in/opt-out
- `notification_templates` - Message templates (for consistency)

### 🚀 Features
- Real-time WebSocket delivery
- SMS via AfricasTalking (sandbox ready)
- Email via Nodemailer
- Atomic transaction (all-or-nothing)
- User preference management (quiet hours, per-type toggles)
- Automatic retry on failure
- Full audit trail
- Production-grade error handling

---

## 🚀 Quick Start (Integration)

### 1. Update Payment Flow in `sales.controller.js`

Add this import:
```javascript
import { emitNotification, notifications } from '#utils/notificationEmitter.js';
```

In your payment success handler, add:
```javascript
// After successful M-Pesa payment
await emitNotification({
  user_id: sale.user_id,
  business_id: sale.business_id,
  ...notifications.paymentComplete({
    amount: sale.total,
    sale_id: sale.id,
    phone: customer_phone,
  }),
});
```

### 2. Update Stock Service (Low Stock Alerts)

In `stock.service.js`, when deducting stock:
```javascript
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

// After stock deduction, check if low
if (newQuantity < minThreshold) {
  await emitNotification({
    user_id: product.user_id,
    ...notifications.lowStock({
      product_name: product.name,
      quantity: newQuantity,
      product_id: product.id,
    }),
  });
}
```

### 3. Update Wallet Service (Low Balance Alerts)

In `wallet.service.js`:
```javascript
// After token deduction, check if low
if (wallet.balance < 5) {
  await emitNotification({
    user_id: wallet.user_id,
    ...notifications.walletLow({
      balance: wallet.balance,
    }),
  });
}
```

---

## 📱 Client-Side Integration

### Connect to WebSocket (JavaScript/React)

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: localStorage.getItem('token'),
  },
});

// Listen for notifications
socket.on('notification', (notif) => {
  console.log('New notification:', notif);
  // Show toast, badge, sound, etc.
  showToast(notif.title, notif.message);
});

// Subscribe to business notifications
socket.emit('subscribe:business', businessId);

// Check connection
socket.on('connect', () => {
  console.log('Connected to notifications');
});

socket.on('disconnect', () => {
  console.log('Disconnected from notifications');
});
```

---

## 📋 API Endpoints

### Get Notifications
```bash
GET /api/notifications?limit=20&offset=0
Authorization: Bearer <token>

Response:
{
  "message": "Notifications retrieved",
  "count": 5,
  "notifications": [
    {
      "id": 1,
      "user_id": 1,
      "type": "payment_complete",
      "title": "Payment Received ✅",
      "message": "Payment of KES 500 completed successfully...",
      "is_read": false,
      "created_at": "2026-02-01T10:30:00Z"
    }
  ]
}
```

### Mark as Read
```bash
PATCH /api/notifications/:notificationId/read
Authorization: Bearer <token>

Response:
{
  "message": "Notification marked as read",
  "notification": { ... }
}
```

### Mark All as Read
```bash
PATCH /api/notifications/read/all
Authorization: Bearer <token>

Response:
{
  "message": "All notifications marked as read"
}
```

### Get Preferences
```bash
GET /api/notifications/preferences
Authorization: Bearer <token>

Response:
{
  "message": "Preferences retrieved",
  "preferences": {
    "sms_enabled": true,
    "email_enabled": true,
    "payment_notifications": true,
    "stock_notifications": true,
    "quiet_hours_enabled": false,
    ...
  }
}
```

### Update Preferences
```bash
PATCH /api/notifications/preferences
Authorization: Bearer <token>

Body:
{
  "sms_enabled": false,
  "payment_notifications": true,
  "quiet_hours_enabled": true,
  "quiet_start": "22:00",
  "quiet_end": "06:00"
}

Response:
{
  "message": "Preferences updated",
  "preferences": { ... }
}
```

### Test Notification (Dev Only)
```bash
POST /api/notifications/test
Authorization: Bearer <token>

Body:
{
  "type": "payment_complete",
  "channel": "all"  // or "sms", "email", "in_app"
}

Response:
{
  "message": "Test notification sent",
  "notification": { ... }
}
```

---

## 🧪 Testing

### Test SMS (Sandbox)
```bash
POST /api/notifications/test
Content-Type: application/json
Authorization: Bearer <token>

{
  "type": "payment_complete",
  "channel": "sms"
}
```

**Note**: In sandbox, SMS goes to fake numbers. No real SMS sent until you add credits.

### Test Email
```bash
POST /api/notifications/test
Authorization: Bearer <token>

{
  "type": "payment_complete",
  "channel": "email"
}
```

**Requires**: SMTP credentials in `.env`

### Test In-App (Real-time)
Open browser console:
```javascript
socket.on('notification', (notif) => {
  console.log('Received:', notif);
});
```

Then call POST /api/notifications/test with `channel: "in_app"`

---

## 🔧 Configuration

### Email Setup (Gmail Example)

1. **Enable 2FA** on Gmail: https://myaccount.google.com/security

2. **Create App Password**:
   - Go to: https://myaccount.google.com/apppasswords
   - Select: Mail + Windows Computer
   - Copy password

3. **Update `.env`**:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password-here
SMTP_FROM=noreply@payme.app
```

4. **Test**: `POST /api/notifications/test`

### SMS Setup (AfricasTalking)

Already configured! Your sandbox is ready to test.

To go production:
1. Add credits to AfricasTalking account (via M-Pesa paybill)
2. Switch `AFRICANTALKING_USERNAME` from `sandbox` to your actual username
3. Done!

---

## 🎯 Notification Types Available

| Type | Channel | Use Case |
|------|---------|----------|
| `payment_complete` | All | After M-Pesa payment succeeds |
| `payment_failed` | All | When M-Pesa payment fails |
| `low_stock` | SMS | When product quantity < threshold |
| `stock_expiring` | SMS | Urgent: stock expiring soon |
| `sale_created` | In-app | After sale created |
| `wallet_low` | SMS | Urgent: wallet < 5 tokens |
| `wallet_purchased` | All | After token purchase |
| `credit_payment_due` | SMS | Credit customer payment due |
| `expense_recorded` | In-app | After expense created |
| `daily_summary` | Email | Optional: daily stats email |

---

## 💾 Example: Hook into Sales Controller

### In `src/controllers/sales.controller.js`:

```javascript
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

// In your payment completion handler:
export const completeSalePayment = async (req, res) => {
  try {
    const { saleId } = req.params;

    // ... existing payment logic ...

    // After M-Pesa callback succeeds:
    await db.update(sales).set({
      payment_status: 'completed',
      paid_at: new Date(),
    }).where(eq(sales.id, saleId));

    // Emit notification
    await emitNotification({
      user_id: sale.user_id,
      business_id: sale.business_id,
      ...notifications.paymentComplete({
        amount: sale.total,
        sale_id: sale.id,
        phone: sale.customer_phone,
      }),
    });

    return res.status(200).json({
      message: 'Sale completed',
      sale,
    });
  } catch (e) {
    logger.error('Error completing sale', e);
    return res.status(500).json({ error: 'Failed to complete sale' });
  }
};
```

---

## 🛠️ Production Checklist

- [ ] **Email**: Configure SMTP (Gmail or SendGrid)
- [ ] **AfricasTalking**: Add credits (when ready for production SMS)
- [ ] **Socket.io**: Test WebSocket in browsers
- [ ] **Integration**: Add `emitNotification()` calls to all key flows
- [ ] **Testing**: Send test notifications for all types
- [ ] **Logging**: Monitor notification delivery in logs
- [ ] **Monitoring**: Set up alerts for notification failures

---

## 📊 Database Queries (For Analytics)

### Count notifications by type
```sql
SELECT type, COUNT(*) as count
FROM notifications
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY type;
```

### SMS delivery rate
```sql
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN sms_sent THEN 1 ELSE 0 END) as delivered,
  ROUND(SUM(CASE WHEN sms_sent THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) as delivery_rate
FROM notifications
WHERE created_at > NOW() - INTERVAL '24 hours' AND sms_sent IS NOT NULL;
```

### Email delivery rate
```sql
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN email_sent THEN 1 ELSE 0 END) as delivered,
  ROUND(SUM(CASE WHEN email_sent THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) as delivery_rate
FROM notifications
WHERE created_at > NOW() - INTERVAL '24 hours' AND email_sent IS NOT NULL;
```

---

## 🚀 Next Steps

1. **Test the system**: `POST /api/notifications/test`
2. **Integrate into sales flow**: Add `emitNotification()` calls
3. **Connect frontend**: Use Socket.io client
4. **Configure email**: Set SMTP credentials
5. **Monitor**: Check logs for delivery status

Ready to integrate? Let me know which controller to update first! 🔥
