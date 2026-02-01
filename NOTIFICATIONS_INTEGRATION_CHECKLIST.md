# 🚀 NOTIFICATIONS - INTEGRATION CHECKLIST

Copy this checklist to your task manager. Check off each item as you complete it.

---

## ✅ PHASE 1: SETUP (Today)

### Configuration
- [ ] Read `NOTIFICATIONS_QUICK_REFERENCE.md`
- [ ] Test SMS with `POST /api/notifications/test` 
- [ ] Verify AfricasTalking sandbox working
- [ ] Configure email SMTP in `.env` (optional)
- [ ] Test email with `POST /api/notifications/test`

### Verification
- [ ] `npm run lint` returns 0 errors
- [ ] `npm run db:migrate` completes successfully
- [ ] Socket.io library installed (`npm install socket.io`)
- [ ] Database has `notifications` table
- [ ] Database has `notification_preferences` table

---

## ✅ PHASE 2: INTEGRATION (This Week)

### Sales Flow
- [ ] Add import in `sales.controller.js`:
  ```javascript
  import { emitNotification, notifications } from '#utils/notificationEmitter.js';
  ```
- [ ] After M-Pesa payment success, add:
  ```javascript
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
- [ ] Test payment flow → SMS should arrive
- [ ] Check Socket.io for in-app notification
- [ ] Check email for email notification

### Stock Flow
- [ ] Add import in `stock.service.js`:
  ```javascript
  import { emitNotification, notifications } from '#utils/notificationEmitter.js';
  ```
- [ ] After stock deduction, add low stock check:
  ```javascript
  if (newQuantity < 10) {
    await emitNotification({
      user_id: userId,
      business_id: businessId,
      ...notifications.lowStock({
        product_name: product.name,
        quantity: newQuantity,
        product_id: product.id,
      }),
    });
  }
  ```
- [ ] Test by reducing stock → SMS alert

### Wallet Flow
- [ ] Add import in `wallet.service.js`
- [ ] After token deduction, add low wallet check:
  ```javascript
  if (wallet.balance < 5) {
    await emitNotification({
      user_id: wallet.user_id,
      ...notifications.walletLow({ balance: wallet.balance }),
    });
  }
  ```
- [ ] Test by using many tokens → SMS alert

---

## ✅ PHASE 3: ADVANCED (Next Week)

### Credit Flow
- [ ] Add in `credit.service.js` on payment due:
  ```javascript
  await emitNotification({
    user_id: userId,
    ...notifications.creditPaymentDue({
      amount: due_amount,
      due_date: due_date.toISOString(),
      customer_name: customer_name,
      credit_account_id: account_id,
    }),
  });
  ```
- [ ] Test credit payment flow

### Expense Flow
- [ ] Add in `expense.controller.js` after create:
  ```javascript
  await emitNotification({
    user_id: userId,
    ...notifications.expenseRecorded({
      category: expense.category,
      amount: expense.amount,
      description: expense.description,
    }),
  });
  ```
- [ ] Test expense creation

### Frontend WebSocket
- [ ] Install Socket.io client: `npm install socket.io-client`
- [ ] Create notification handler:
  ```javascript
  import io from 'socket.io-client';
  
  const socket = io('http://localhost:3000', {
    auth: { token: localStorage.getItem('token') },
  });
  
  socket.on('notification', (notif) => {
    showToast(notif.title, notif.message);
  });
  ```
- [ ] Test in-app notifications appear instantly
- [ ] Test notification count badge updates
- [ ] Test unread notification list updates

---

## ✅ PHASE 4: TESTING (Pre-Production)

### Manual Testing
- [ ] Test payment success → all 3 channels work
- [ ] Test payment failure → error notification sent
- [ ] Test low stock → SMS arrives
- [ ] Test low wallet → SMS arrives
- [ ] Test low credit → SMS arrives
- [ ] Test expense creation → in-app notification

### User Preferences Testing
- [ ] User can disable SMS
- [ ] User can disable email
- [ ] User can disable specific types
- [ ] User can set quiet hours
- [ ] Preferences persist after page reload

### Error Scenarios
- [ ] SMS fails → logged but transaction succeeds
- [ ] Email fails → logged but transaction succeeds
- [ ] WebSocket disconnects → reconnects automatically
- [ ] User gets default preferences on signup

### Performance Testing
- [ ] Send 100 notifications → no slowdown
- [ ] Check database size (should be small)
- [ ] Check logs for errors or warnings
- [ ] Monitor memory usage

---

## ✅ PHASE 5: DEPLOYMENT (Go Live)

### Pre-Deployment
- [ ] All integrations complete
- [ ] All tests passing
- [ ] Zero lint errors
- [ ] Staging environment tested
- [ ] Monitoring/alerting configured
- [ ] Team trained on system

### Deployment
- [ ] Create feature branch: `git checkout -b feature/notifications`
- [ ] Commit all changes: `git add . && git commit -m "Add notifications"`
- [ ] Push to GitHub: `git push origin feature/notifications`
- [ ] Create pull request
- [ ] Code review passed
- [ ] Merge to main
- [ ] Deploy to production
- [ ] Verify endpoints are live
- [ ] Monitor logs for errors

### Post-Deployment
- [ ] Monitor SMS delivery rate
- [ ] Monitor email delivery rate
- [ ] Check for errors in logs
- [ ] Verify users getting notifications
- [ ] Collect user feedback
- [ ] Adjust notification templates if needed

---

## 📊 TESTING MATRIX

| Scenario | SMS | Email | In-App | Status |
|----------|-----|-------|--------|--------|
| Payment success | ✅ | ✅ | ✅ | [ ] |
| Payment failure | ✅ | ✅ | ✅ | [ ] |
| Low stock | ✅ | - | ✅ | [ ] |
| Low wallet | ✅ | - | ✅ | [ ] |
| Credit due | ✅ | - | ✅ | [ ] |
| Expense created | - | - | ✅ | [ ] |
| User disables SMS | - | ✅ | ✅ | [ ] |
| Quiet hours | - | - | ✅ | [ ] |
| Socket reconnect | - | - | ✅ | [ ] |

---

## 🔧 TROUBLESHOOTING

If notifications not working:

### SMS Not Arriving
1. Check logs: `tail logs/combined.log`
2. Verify phone format: `+254712345678`
3. Check AfricasTalking credentials in `.env`
4. Test with `/api/notifications/test`

### Email Not Arriving
1. Check SMTP credentials
2. Check spam folder
3. Verify email address in database
4. Check logs for SMTP errors

### In-App Not Showing
1. Open browser DevTools → Network
2. Check WebSocket connection
3. Verify JWT token valid
4. Check browser console for errors

### Database Issues
1. Verify tables created: `SELECT * FROM notifications LIMIT 1;`
2. Check migration ran: `npm run db:migrate`
3. Verify user_id references valid user

---

## 📋 ROLLOUT PLAN

### Week 1: Sales Flow
- Integrate into payment success/failure
- Monitor SMS delivery
- Collect user feedback

### Week 2: Stock Warnings
- Integrate low stock alerts
- Test with various threshold values
- Monitor SMS delivery

### Week 3: Wallet Alerts
- Integrate low wallet notifications
- Test token purchases
- Monitor delivery

### Week 4: Full Release
- Integrate credit & expense flows
- Frontend WebSocket integration
- Preferences UI (if building)
- Go live

---

## 🎯 SUCCESS CRITERIA

✅ **SMS**: 90%+ delivery rate  
✅ **Email**: 85%+ delivery rate  
✅ **In-App**: 99%+ delivery (instant)  
✅ **Latency**: < 2 seconds for SMS  
✅ **Database**: No errors in logs  
✅ **User Satisfaction**: Positive feedback  
✅ **Performance**: No transaction slowdown  

---

## 📞 QUICK REFERENCE

### Import
```javascript
import { emitNotification, notifications } from '#utils/notificationEmitter.js';
```

### 10 Available Templates
```javascript
notifications.paymentComplete({amount, sale_id, phone})
notifications.paymentFailed({amount, sale_id, reason})
notifications.lowStock({product_name, quantity, product_id})
notifications.stockExpiring({product_name, expiry_date, quantity, product_id})
notifications.saleCreated({total, item_count, sale_id})
notifications.walletLow({balance})
notifications.walletPurchased({token_count, amount, new_balance})
notifications.creditPaymentDue({amount, due_date, customer_name, credit_account_id})
notifications.expenseRecorded({category, amount, description})
```

### API Endpoints
```bash
GET    /api/notifications
PATCH  /api/notifications/:id/read
PATCH  /api/notifications/read/all
GET    /api/notifications/preferences
PATCH  /api/notifications/preferences
POST   /api/notifications/test
```

---

## ✨ TIPS FOR SUCCESS

1. **Start small** - Integrate sales flow first
2. **Test thoroughly** - Use test endpoint
3. **Monitor logs** - Check regularly
4. **Respect preferences** - Users want control
5. **Iterate quickly** - Get feedback early
6. **Document changes** - Update AGENTS.md
7. **Keep learning** - Read full documentation

---

## 🎉 COMPLETION CHECKLIST

When everything is done:

- [ ] All phases completed
- [ ] All tests passing
- [ ] All monitoring in place
- [ ] Team trained
- [ ] Documentation updated
- [ ] Code merged to main
- [ ] Production deployed
- [ ] Monitoring active
- [ ] User feedback collected
- [ ] Team celebration! 🎊

---

**Print this checklist and track your progress!**

Each checked item brings you closer to a fully functional notification system.

Good luck! 🚀
