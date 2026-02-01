# PayMe API - Quick Setup & Testing Guide

## What's Been Implemented

### 1. ✅ Pochi La Biashara Removal
Removed all references to pochi la biashara (Pochi) and send_money payment methods from:
- `src/validations/businesses.validation.js` - Updated enum to only include till_number, paybill, wallet
- `src/models/setting.model.js` - Updated comments and payment_method values
- `src/services/myWallet.service.js` - Removed pochi from product mapping
- `src/controllers/sales.controller.js` - Removed pochi from product map
- `src/server.js` - Removed MPESA_SHORTCODE_POCHI and MPESA_PASSKEY_POCHI from required env vars

### 2. ✅ Wallet Payment System Implementation
Implemented complete wallet payment system with:
- **Fixed Paybill**: 650880
- **Fixed Account**: 37605544
- **Payment Method**: M-Pesa STK Push (CustomerPayBillOnline)

**Files Created**:
- `src/controllers/walletPayment.controller.js` - 5 endpoint handlers
- `src/routes/walletPayment.routes.js` - Route definitions
- Updated `src/models/myWallet.model.js` - Added walletPayments table
- Updated `src/app.js` - Integrated wallet payment routes

**Database Migration**:
- Generated migration: `drizzle/0010_overconfident_fixer.sql`
- New table: `wallet_payments` with fields:
  - business_id, sale_id, amount_ksh, phone
  - payment_status, paybill, account_reference
  - mpesa_transaction_id, callback_payload

### 3. ✅ XSS Security Implementation
Installed and integrated Node.js security libraries:

**Packages Installed**:
- `express-validator` - Request validation and sanitization
- `sanitize-html` - HTML sanitization
- `xss` - XSS prevention library
- `hpp` - HTTP Parameter Pollution protection
- `helmet` - (Already installed) Security headers

**Files Created**:
- `src/middleware/xss.middleware.js` - Comprehensive XSS protection stack

**Middleware Stack** (in order):
1. `securityHeaders` - Helmet with CSP, HSTS, X-Frame-Options, etc.
2. `hppProtection` - HPP prevention
3. `suspiciousActivityLogger` - Logs XSS-like patterns
4. `bodyValidator` - Deep sanitizes req.body, req.query, req.params
5. `cookieSecurity` - Secure cookie attributes (httpOnly, secure, sameSite)
6. `responseHeaderSanitization` - Removes sensitive headers, sets security headers

**Protection Against**:
- Script injection: `<script>`, `<iframe>`, `<embed>`, `<applet>`, `<object>`
- Event handlers: `onclick=`, `onerror=`, `onload=`, `on*=`
- JavaScript URIs: `javascript:`, `data:text/html`
- Parameter pollution: Multiple parameters with same name
- Cookie theft: httpOnly flag + secure flag + sameSite
- Clickjacking: X-Frame-Options DENY
- MIME sniffing: X-Content-Type-Options nosniff

## Setup Instructions

### 1. Install Security Dependencies
```bash
cd c:\Users\kkc12\payme
npm install express-validator sanitize-html xss hpp --save
```

✅ **Already Done** - All packages installed

### 2. Generate Database Migration
```bash
npm run db:generate
```

✅ **Already Done** - Migration 0010_overconfident_fixer.sql created

### 3. Apply Database Migration
```bash
npm run db:migrate
```

**Run this to apply the wallet_payments table to your database**

### 4. Verify Environment Variables
Ensure your `.env` has:
```env
# Existing M-Pesa variables (no new ones needed)
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_SHORTCODE_PAYBILL=your_paybill
MPESA_PASSKEY_PAYBILL=your_passkey
MPESA_SHORTCODE_TILL=your_till
MPESA_PASSKEY_TILL=your_till_key
MPESA_CALLBACK_URL=https://yourdomain.com/api/callback

# These are now REMOVED (no longer required):
# MPESA_SHORTCODE_POCHI
# MPESA_PASSKEY_POCHI
```

### 5. Start the Server
```bash
npm run dev
```

Server will start with all security measures active.

## Testing Wallet Payment with HTTPie

### Prerequisites
1. Install HTTPie: `pip install httpie` or `choco install httpie`
2. Get a JWT token by logging in first
3. Have a business created with `payment_method: "wallet"`

### 1. Login to Get JWT Token
```bash
http POST http://localhost:3000/api/auth/signin \
  email="test@example.com" \
  password="password123"
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "email": "test@example.com" }
}
```

Store token: `export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."`

### 2. Create a Business (if not exists)
```bash
http POST http://localhost:3000/api/businesses \
  Authorization:"Bearer $TOKEN" \
  name="My Wallet Store" \
  location="Nairobi" \
  payment_method="wallet" \
  payment_identifier="37605544"
```

**Response**:
```json
{
  "message": "Business created",
  "business": { "id": 5, "name": "My Wallet Store" }
}
```

Store: `export BUSINESS_ID=5`

### 3. Check Wallet Balance
```bash
http GET http://localhost:3000/api/wallet-payment/balance/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"
```

**Expected Response** (initially empty):
```json
{
  "message": "Wallet balance retrieved",
  "wallet": {
    "id": 12,
    "businessId": 5,
    "balanceTokens": 0,
    "balanceKsh": 0
  }
}
```

### 4. Create a Sale
```bash
http POST http://localhost:3000/api/sales \
  Authorization:"Bearer $TOKEN" \
  businessId:=$BUSINESS_ID \
  items:='[
    {"productId": 1, "quantity": 2, "unitPrice": 500}
  ]'
```

**Response**:
```json
{
  "message": "Sale created",
  "sale": { "id": 123, "total_amount": "1000" }
}
```

Store: `export SALE_ID=123`

### 5. Initiate Wallet Payment
```bash
http POST http://localhost:3000/api/wallet-payment/initiate \
  Authorization:"Bearer $TOKEN" \
  saleId:=$SALE_ID \
  phone="254712345678" \
  amount:=1000
```

**Response**:
```json
{
  "message": "Wallet payment initiated successfully",
  "walletPayment": {
    "id": 45,
    "saleId": 123,
    "amount": 1000,
    "phone": "254712345678",
    "paybill": "650880",
    "account": "37605544",
    "paymentStatus": "pending",
    "createdAt": "2026-01-31T10:30:00Z",
    "instructions": "To complete payment, use M-Pesa paybill 650880 with account number 37605544"
  }
}
```

Store: `export PAYMENT_ID=45`

### 6. Check Payment Status
```bash
http GET http://localhost:3000/api/wallet-payment/status/$PAYMENT_ID \
  Authorization:"Bearer $TOKEN"
```

**Response**:
```json
{
  "message": "Wallet payment status retrieved",
  "walletPayment": {
    "id": 45,
    "saleId": 123,
    "amount": 1000,
    "phone": "254712345678",
    "status": "pending",
    "mpesaTransactionId": null
  }
}
```

### 7. Simulate M-Pesa Callback (Payment Success)
```bash
http POST http://localhost:3000/api/wallet-payment/complete \
  walletPaymentId:=$PAYMENT_ID \
  mpesaTransactionId="LHD61H8J60" \
  status="success"
```

**Response**:
```json
{
  "message": "Wallet payment status updated",
  "status": "Payment successful"
}
```

### 8. Verify Wallet Balance Updated
```bash
http GET http://localhost:3000/api/wallet-payment/balance/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"
```

**Expected Response** (balance increased):
```json
{
  "message": "Wallet balance retrieved",
  "wallet": {
    "id": 12,
    "businessId": 5,
    "balanceTokens": 500,
    "balanceKsh": 1000,
    "updatedAt": "2026-01-31T10:32:00Z"
  }
}
```

### 9. View Transaction History
```bash
http GET http://localhost:3000/api/wallet-payment/transactions/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"
```

**Response**:
```json
{
  "message": "Wallet transaction history retrieved",
  "transactions": [
    {
      "id": 101,
      "changeTokens": 500,
      "type": "purchase",
      "reference": "PAYMENT-45",
      "note": "Wallet payment for sale #123",
      "createdAt": "2026-01-31T10:32:00Z"
    }
  ]
}
```

## Testing XSS Protection with HTTPie

### Test 1: Script Tag Injection (Should Be Sanitized)
```bash
http POST http://localhost:3000/api/businesses \
  Authorization:"Bearer $TOKEN" \
  name="<script>alert('xss')</script>" \
  location="Nairobi" \
  payment_method="wallet" \
  payment_identifier="37605544"
```

**What Happens**:
- Name field is sanitized to empty string
- Suspicious activity logged to `logs/error.log`
- Request continues with safe data

### Test 2: Image Tag with Event Handler
```bash
http POST http://localhost:3000/api/stock/products \
  Authorization:"Bearer $TOKEN" \
  businessId:=$BUSINESS_ID \
  product_name="<img src=x onerror=alert('xss')>" \
  quantity:=10
```

**What Happens**:
- Product name sanitized: `<img...>` → empty
- Logged as suspicious

### Test 3: JavaScript URI
```bash
http POST http://localhost:3000/api/businesses \
  Authorization:"Bearer $TOKEN" \
  name="Safe Name" \
  location="javascript:alert('xss')" \
  payment_method="wallet" \
  payment_identifier="37605544"
```

**What Happens**:
- Location sanitized (javascript: removed)
- Suspicious pattern logged

### Test 4: Valid Request (Should Work)
```bash
http POST http://localhost:3000/api/businesses \
  Authorization:"Bearer $TOKEN" \
  name="John's Store & Co." \
  location="Downtown Nairobi, Kenya" \
  payment_method="wallet" \
  payment_identifier="37605544"
```

**Expected**: Request succeeds, special characters preserved

## Monitoring Security

### Check Security Logs
```bash
tail -f logs/error.log
tail -f logs/combined.log
```

**What to Look For**:
- XSS detection messages: `Suspicious XSS-like activity detected`
- Failed requests with suspicious patterns
- Rate limiting blocks (from Arcjet)

### Check HTTP Headers
```bash
http --headers GET http://localhost:3000/health
```

**Should See**:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: ...
```

## Troubleshooting

### Database Migration Failed
```bash
npm run db:migrate
```

If still fails, check:
1. Database URL is correct: `echo $DATABASE_URL`
2. Database connection works
3. Drizzle migrations history: `drizzle/_journal.json`

### Wallet Payment Not Working
1. Verify business has `payment_method: "wallet"`
2. Check sale exists: `GET /api/sales/:saleId`
3. Verify phone format: `254712345678` or `0712345678`
4. Check wallet_payments table created: `SELECT * FROM wallet_payments;`

### XSS Protection Too Strict
- Check `logs/error.log` for sanitization details
- Review suspicious patterns being blocked
- Adjust patterns in `src/middleware/xss.middleware.js` if needed
- Ensure legitimate data formats are preserved

### Performance Issues
- Monitor middleware execution time in logs
- Profile with: `NODE_DEBUG=*`
- Check deep object nesting in requests

## Next Steps

1. **Apply Migration**: `npm run db:migrate`
2. **Run Server**: `npm run dev`
3. **Test Flow**: Follow steps 1-9 above with HTTPie
4. **Monitor Logs**: Watch for XSS attempts and payment processing
5. **Deploy**: Push to production with confidence

## Files Modified

### Removed Pochi References
- `src/validations/businesses.validation.js`
- `src/models/setting.model.js`
- `src/services/myWallet.service.js`
- `src/controllers/sales.controller.js`
- `src/server.js`

### Wallet Payment Implementation
- ✅ Created `src/controllers/walletPayment.controller.js`
- ✅ Created `src/routes/walletPayment.routes.js`
- ✅ Updated `src/models/myWallet.model.js`
- ✅ Updated `src/app.js`

### XSS Security
- ✅ Created `src/middleware/xss.middleware.js`
- ✅ Updated `src/app.js` with security middleware stack
- ✅ Installed: express-validator, sanitize-html, xss, hpp

### Documentation
- ✅ Created `WALLET_PAYMENT_IMPLEMENTATION.md`
- ✅ Created `XSS_SECURITY_IMPLEMENTATION.md`
- ✅ Created `QUICK_SETUP_TESTING.md` (this file)

## Support

For issues or questions:
1. Check the comprehensive guides: `WALLET_PAYMENT_IMPLEMENTATION.md` and `XSS_SECURITY_IMPLEMENTATION.md`
2. Review middleware implementation in `src/middleware/xss.middleware.js`
3. Check logs: `logs/error.log` and `logs/combined.log`
4. Verify environment variables are set
5. Test with HTTPie examples provided

Good luck! 🚀
