# Quick Start Guide - Wallet Payment & XSS Security

## 🚀 Quick Setup (5 minutes)

### Step 1: Apply Database Migration
```bash
cd c:\Users\kkc12\payme
npm run db:migrate
```

### Step 2: Start the Server
```bash
npm run dev
```

Server runs on: `http://localhost:3000`

### Step 3: Verify Installation
```bash
http http://localhost:3000/health
```

Expected response:
```json
{
  "status": "OK",
  "timestamp": "2026-01-31T...",
  "uptime": 2.345,
  "environment": "development"
}
```

---

## 💰 Wallet Payment Testing

### Sign In
```bash
http POST http://localhost:3000/api/auth/signin \
  email="test@example.com" \
  password="password123"
```

Save the token in your shell:
```bash
export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Create Business (Wallet Payment Enabled)
```bash
http POST http://localhost:3000/api/businesses \
  Authorization:"Bearer $TOKEN" \
  name="My Store" \
  location="Nairobi" \
  payment_method="wallet" \
  payment_identifier="37605544"
```

Save the business ID:
```bash
export BUSINESS_ID=5
```

### Create a Sale
```bash
http POST http://localhost:3000/api/sales \
  Authorization:"Bearer $TOKEN" \
  businessId:=$BUSINESS_ID \
  items:='[{"productId":1,"quantity":2,"unitPrice":500}]'
```

Save the sale ID:
```bash
export SALE_ID=123
```

### Initiate Wallet Payment
```bash
http POST http://localhost:3000/api/wallet-payment/initiate \
  Authorization:"Bearer $TOKEN" \
  saleId:=$SALE_ID \
  phone="254712345678" \
  amount:=1000
```

Save the payment ID:
```bash
export PAYMENT_ID=45
```

### Simulate M-Pesa Callback (Success)
```bash
http POST http://localhost:3000/api/wallet-payment/complete \
  walletPaymentId:=$PAYMENT_ID \
  mpesaTransactionId="LHD61H8J60" \
  status="success"
```

### Check Wallet Balance
```bash
http GET http://localhost:3000/api/wallet-payment/balance/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"
```

### View Transaction History
```bash
http GET http://localhost:3000/api/wallet-payment/transactions/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"
```

---

## 🔒 XSS Security Testing

### Test 1: Script Injection (Should Be Blocked)
```bash
http POST http://localhost:3000/api/businesses \
  Authorization:"Bearer $TOKEN" \
  name="<script>alert('xss')</script>" \
  location="Nairobi" \
  payment_method="wallet" \
  payment_identifier="37605544"

# Result: Name field sanitized to empty/safe value
# Check logs: tail logs/error.log (should see "Suspicious XSS-like activity")
```

### Test 2: Event Handler Injection
```bash
http POST http://localhost:3000/api/stock \
  Authorization:"Bearer $TOKEN" \
  businessId:=$BUSINESS_ID \
  product_name="<img onerror=alert('xss')>" \
  quantity:=10

# Result: Product name sanitized, suspicious activity logged
```

### Test 3: Valid Characters (Should Pass)
```bash
http POST http://localhost:3000/api/businesses \
  Authorization:"Bearer $TOKEN" \
  name="John's Store & Co." \
  location="Downtown Nairobi" \
  payment_method="wallet" \
  payment_identifier="37605544"

# Result: Request succeeds, apostrophes and ampersands preserved
```

---

## 📊 Wallet Payment Flow

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: Initiate Payment                                │
│ POST /api/wallet-payment/initiate                       │
│ → Creates wallet_payment record in DB                   │
│ → Returns paybill 650880, account 37605544              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Step 2: Customer Pays via M-Pesa                        │
│ - Receives STK Push on phone                            │
│ - Enters PIN to pay paybill 650880                      │
│ - Amount: KSH 1000                                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Step 3: M-Pesa Callback (Webhook)                       │
│ POST /api/wallet-payment/complete                       │
│ - Receives status: success/failed                       │
│ - Updates wallet_payments record                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Step 4: Add Tokens to Wallet                            │
│ - Create wallet_transaction record                      │
│ - Update wallet balance: KSH 1000 ÷ 2 = 500 tokens      │
│ - Ready for sale completion                             │
└─────────────────────────────────────────────────────────┘
```

---

## 🔐 Security Features

### 7 Layers of XSS Protection
1. **Helmet.js** - Security HTTP headers
2. **HPP** - Parameter pollution protection
3. **XSS Library** - Strips dangerous tags and attributes
4. **sanitize-html** - HTML sanitization with whitelist
5. **Input Validation** - Zod schemas (existing)
6. **Cookie Security** - httpOnly, secure, sameSite
7. **Suspicious Activity Logging** - Detects attack patterns

### Protected Against
- `<script>` injection
- Event handlers: `onclick=`, `onerror=`, etc.
- JavaScript URIs: `javascript:alert()`
- Data URIs: `data:text/html,...`
- Parameter pollution: Multiple params with same name
- Cookie theft: XSS + CSRF

---

## 📝 Removed Features

The following payment methods have been permanently removed:
- ❌ `pochi_la_biashara` (Pochi la Biashara)
- ❌ `send_money` (M-Pesa Send Money)

**Replaced by unified wallet system**: `paybill 650880`, `account 37605544`

---

## 🐛 Troubleshooting

### Payment Stuck in Pending
- Check M-Pesa callback is being received
- Verify `MPESA_CALLBACK_URL` is publicly accessible
- Check phone number format: `254712345678` or `0712345678`

### Invalid Phone Format
```
Error: "Invalid phone number format"
```

Valid formats:
- `254712345678` (with country code)
- `0712345678` (local format)
- Must be Kenyan number (7, 1 as 2nd digit)

### XSS Bypass Attempts
- All suspicious activity logged to `logs/error.log`
- Check logs to identify attack patterns
- IP address of attacker is recorded
- Use for security monitoring and blocking

### Wallet Balance Not Updating
1. Verify callback was received (check `wallet_payments.mpesa_transaction_id`)
2. Check `wallet_transactions` table for audit trail
3. Verify `wallet_payments.payment_status = 'completed'`

---

## 📚 Documentation Files

1. **IMPLEMENTATION_COMPLETE.md** - Full implementation details
2. **WALLET_PAYMENT_IMPLEMENTATION.md** - Wallet payment API docs
3. **XSS_SECURITY_IMPLEMENTATION.md** - Security hardening guide
4. **AGENTS.md** - Overall architecture overview

---

## 🔄 Production Checklist

Before going to production:

- [ ] Run database migration: `npm run db:migrate`
- [ ] Test wallet payment flow with HTTPie
- [ ] Test XSS protection with malicious payloads
- [ ] Verify linting passes: `npm run lint`
- [ ] Update M-Pesa credentials for production environment
- [ ] Verify `MPESA_CALLBACK_URL` points to production domain
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS in production (secure cookies require it)
- [ ] Configure SSL/TLS certificates
- [ ] Set up log rotation for `logs/` directory
- [ ] Configure monitoring alerts for suspicious activity
- [ ] Test M-Pesa callbacks from production servers
- [ ] Set up backup and disaster recovery

---

## 💡 Key Metrics

### Token Exchange Rate
- **1 token = KSH 2** (fixed)
- Customer pays KSH → Converted to tokens → Used for sales

### Payment Method Configuration
```javascript
{
  "payment_method": "wallet",      // or "till_number", "paybill"
  "payment_identifier": "37605544" // Fixed for wallet
}
```

### Wallet Payment Constants
```javascript
WALLET_PAYBILL = '650880'      // Daraja API paybill
WALLET_ACCOUNT = '37605544'    // Account reference
```

---

## 🎯 Success Indicators

✅ Your implementation is complete when:

1. Database migration runs without errors
2. Server starts successfully
3. Wallet payment endpoints respond correctly
4. XSS protection blocks malicious input
5. Legitimate requests with special characters pass through
6. Logs show security activity for suspicious requests
7. All tests in HTTPie scripts pass

---

## 📞 Support

### Log Files
- `logs/error.log` - Errors only
- `logs/combined.log` - All log levels
- Console output in development

### Common Log Patterns

**Suspicious Activity Detected:**
```json
{
  "level": "warn",
  "message": "Suspicious XSS-like activity detected",
  "body": { "malicious": "payload" }
}
```

**Wallet Payment Initiated:**
```json
{
  "level": "info",
  "message": "Wallet payment initiated",
  "walletPaymentId": 45,
  "amount": 1000
}
```

---

## ✨ Next Steps

1. **Immediate**: Run `npm run db:migrate` and `npm run dev`
2. **Test**: Use HTTPie examples above
3. **Monitor**: Watch logs during testing
4. **Deploy**: Follow your production deployment process
5. **Monitor**: Track wallet payments and XSS attempts

**You're ready to go!** 🎉
