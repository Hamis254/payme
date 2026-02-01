# Wallet Payment Implementation Guide

## Overview

The Wallet Payment system is a simplified payment method that uses a fixed M-Pesa paybill (650880) with account number (37605544) for processing sales payments. This replaces the need for businesses to configure their own payment identifiers.

## Key Features

- **Fixed Paybill**: `650880`
- **Fixed Account**: `37605544`
- **Payment Method**: M-Pesa STK Push (CustomerPayBillOnline)
- **Token Value**: 1 token = KSH 2
- **Supports**: All business types in sandbox and production

## Configuration

### Environment Variables

No additional environment variables required beyond existing M-Pesa credentials:

```env
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE_PAYBILL=your_shortcode
MPESA_PASSKEY_PAYBILL=your_passkey
MPESA_CALLBACK_URL=https://yourdomain.com/api/callback
```

### Business Setup

When creating or updating a business, set `payment_method` to `wallet`:

```bash
curl -X POST http://localhost:3000/api/businesses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "My Store",
    "location": "Nairobi",
    "payment_method": "wallet",
    "payment_identifier": "37605544"
  }'
```

## API Endpoints

### 1. Initiate Wallet Payment

**Endpoint**: `POST /api/wallet-payment/initiate`

Initiates an M-Pesa STK Push for a sale payment.

**Headers**:
```
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

**Request Body**:
```json
{
  "saleId": 123,
  "phone": "254712345678",
  "amount": 1000
}
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

**HTTPie Testing**:
```bash
# Initialize wallet payment for a sale
http POST http://localhost:3000/api/wallet-payment/initiate \
  Authorization:"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  saleId:=123 \
  phone="254712345678" \
  amount:=1000
```

### 2. Complete Wallet Payment (M-Pesa Callback)

**Endpoint**: `POST /api/wallet-payment/complete`

Called by M-Pesa callback handler to finalize payment and add tokens to wallet.

**Request Body**:
```json
{
  "walletPaymentId": 45,
  "mpesaTransactionId": "LHD61H8J60",
  "status": "success"
}
```

**Response**:
```json
{
  "message": "Wallet payment status updated",
  "status": "Payment successful"
}
```

**HTTPie Testing**:
```bash
# Simulate M-Pesa callback (would normally be from Safaricom)
http POST http://localhost:3000/api/wallet-payment/complete \
  walletPaymentId:=45 \
  mpesaTransactionId="LHD61H8J60" \
  status="success"
```

### 3. Get Wallet Payment Status

**Endpoint**: `GET /api/wallet-payment/status/:paymentId`

Check the status of a wallet payment.

**Headers**:
```
Authorization: Bearer JWT_TOKEN
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
    "status": "completed",
    "mpesaTransactionId": "LHD61H8J60",
    "createdAt": "2026-01-31T10:30:00Z",
    "updatedAt": "2026-01-31T10:32:00Z"
  }
}
```

**HTTPie Testing**:
```bash
http GET http://localhost:3000/api/wallet-payment/status/45 \
  Authorization:"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 4. Get Wallet Balance

**Endpoint**: `GET /api/wallet-payment/balance/:businessId`

Get current token balance for a business wallet.

**Headers**:
```
Authorization: Bearer JWT_TOKEN
```

**Response**:
```json
{
  "message": "Wallet balance retrieved",
  "wallet": {
    "id": 12,
    "businessId": 5,
    "balanceTokens": 500,
    "balanceKsh": 1000,
    "createdAt": "2026-01-30T14:20:00Z",
    "updatedAt": "2026-01-31T10:32:00Z"
  }
}
```

**HTTPie Testing**:
```bash
http GET http://localhost:3000/api/wallet-payment/balance/5 \
  Authorization:"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 5. Get Wallet Transaction History

**Endpoint**: `GET /api/wallet-payment/transactions/:businessId`

Get all transaction history for a business wallet.

**Headers**:
```
Authorization: Bearer JWT_TOKEN
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
    },
    {
      "id": 100,
      "changeTokens": -250,
      "type": "charge",
      "reference": "SALE-123",
      "note": "Tokens charged for sale completion",
      "createdAt": "2026-01-31T10:35:00Z"
    }
  ]
}
```

**HTTPie Testing**:
```bash
http GET http://localhost:3000/api/wallet-payment/transactions/5 \
  Authorization:"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Complete Payment Flow

### Step 1: Create a Sale
```bash
http POST http://localhost:3000/api/sales \
  Authorization:"Bearer JWT_TOKEN" \
  businessId:=5 \
  items:='[{"productId":1,"quantity":2,"unitPrice":500}]'
```

### Step 2: Initiate Wallet Payment
```bash
http POST http://localhost:3000/api/wallet-payment/initiate \
  Authorization:"Bearer JWT_TOKEN" \
  saleId:=123 \
  phone="254712345678" \
  amount:=1000
```

### Step 3: Customer Completes Payment on Phone
- Customer receives STK push on their M-Pesa phone
- Enters PIN to complete payment to paybill 650880, account 37605544
- Amount: KSH 1000

### Step 4: M-Pesa Callback Updates Payment
```bash
# This would be called by M-Pesa servers
http POST http://localhost:3000/api/wallet-payment/complete \
  walletPaymentId:=45 \
  mpesaTransactionId="LHD61H8J60" \
  status="success"
```

### Step 5: Verify Wallet Balance
```bash
http GET http://localhost:3000/api/wallet-payment/balance/5 \
  Authorization:"Bearer JWT_TOKEN"
```

## Token Economics

- **Purchase Price**: KSH 2 per token (retail)
- **Sale Charge**: 1 token = 1 sale item (configurable)
- **Example**:
  - Customer pays KSH 1000
  - 1000 ÷ 2 = 500 tokens added to wallet
  - If selling items use 1 token per item: 500 tokens can process 500 items

## Security Measures

### XSS Protection
The wallet payment system includes comprehensive XSS protection:

- **Helmet.js**: Security headers (CSP, X-Frame-Options, HSTS, etc.)
- **HPP Protection**: HTTP Parameter Pollution prevention
- **Input Sanitization**: All request inputs sanitized via `deepSanitize()`
- **HTML Sanitization**: Using sanitize-html library
- **XSS Detection**: Using xss library for additional protection
- **Suspicious Activity Logging**: Detects and logs XSS-like patterns
- **Cookie Security**: httpOnly, secure, sameSite attributes

### Database Security
- All user input is sanitized before database operations
- Proper parameterized queries via Drizzle ORM
- User ownership verification on all operations

### Payment Security
- Phone number format validation (Kenya-specific)
- Amount validation (positive numbers only)
- Business ownership verification before payment initiation
- Transaction audit trail in wallet_transactions table

## Error Handling

### Common Error Responses

**400 - Missing Fields**:
```json
{
  "error": "Missing required fields: saleId, phone, amount"
}
```

**400 - Invalid Phone**:
```json
{
  "error": "Invalid phone number format"
}
```

**403 - Access Denied**:
```json
{
  "error": "Business not found or access denied"
}
```

**404 - Not Found**:
```json
{
  "error": "Sale not found"
}
```

**500 - Server Error**:
```json
{
  "error": "Internal server error",
  "requestId": "abc123"
}
```

## Database Schema

### wallet_payments Table
```sql
CREATE TABLE wallet_payments (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  amount_ksh INTEGER NOT NULL,
  phone VARCHAR(20) NOT NULL,
  payment_status VARCHAR(20) DEFAULT 'pending',
  paybill VARCHAR(10) NOT NULL,
  account_reference VARCHAR(50) NOT NULL,
  mpesa_transaction_id VARCHAR(128),
  callback_payload TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### wallet_transactions Table
```sql
CREATE TABLE wallet_transactions (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  change_tokens INTEGER NOT NULL,
  type VARCHAR(50) NOT NULL,
  reference VARCHAR(255),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Testing with HTTPie

### Quick Test Script

```bash
#!/bin/bash

# Get JWT token (use your credentials)
TOKEN=$(http POST http://localhost:3000/api/auth/signin \
  email="user@example.com" \
  password="password" | jq -r '.token')

BUSINESS_ID=5
SALE_ID=123

# 1. Check wallet balance
echo "=== Checking wallet balance ==="
http GET http://localhost:3000/api/wallet-payment/balance/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"

# 2. Initiate payment
echo -e "\n=== Initiating wallet payment ==="
PAYMENT_RESPONSE=$(http POST http://localhost:3000/api/wallet-payment/initiate \
  Authorization:"Bearer $TOKEN" \
  saleId:=$SALE_ID \
  phone="254712345678" \
  amount:=1000)

echo $PAYMENT_RESPONSE
PAYMENT_ID=$(echo $PAYMENT_RESPONSE | jq -r '.walletPayment.id')

# 3. Check payment status
echo -e "\n=== Checking payment status ==="
http GET http://localhost:3000/api/wallet-payment/status/$PAYMENT_ID \
  Authorization:"Bearer $TOKEN"

# 4. Simulate M-Pesa callback (success)
echo -e "\n=== Simulating M-Pesa callback ==="
http POST http://localhost:3000/api/wallet-payment/complete \
  walletPaymentId:=$PAYMENT_ID \
  mpesaTransactionId="LHD61H8J60" \
  status="success"

# 5. Check wallet balance again
echo -e "\n=== Checking updated wallet balance ==="
http GET http://localhost:3000/api/wallet-payment/balance/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"

# 6. View transaction history
echo -e "\n=== Viewing transaction history ==="
http GET http://localhost:3000/api/wallet-payment/transactions/$BUSINESS_ID \
  Authorization:"Bearer $TOKEN"
```

## Troubleshooting

### Payment Stuck in Pending
1. Check M-Pesa logs for callback issues
2. Verify `MPESA_CALLBACK_URL` is publicly accessible
3. Check phone number format matches Daraja API expectations

### Invalid Phone Format
- Ensure phone starts with +254 or 0
- Format: `+254712345678` or `0712345678`
- Must be 10-11 digits total

### Token Balance Not Updating
1. Check wallet exists: `GET /api/wallet-payment/balance/:businessId`
2. Check callback was received: View wallet_payments.mpesa_transaction_id
3. Check wallet_transactions table for audit trail

### XSS Protection Issues
- If getting sanitization errors, ensure inputs are plain text
- Don't include HTML or script tags in request body
- Suspicious patterns are logged to `logs/error.log`

## Next Steps

1. **Test in Sandbox**: Use HTTPie to test all endpoints
2. **Setup M-Pesa Callbacks**: Configure webhook to handle payment completion
3. **Deploy to Production**: Update M-Pesa credentials when ready
4. **Monitor**: Check logs for suspicious activity and payment failures

## Removed Features

The following payment methods have been removed:
- ~~pochi_la_biashara~~ (Pochi la Biashara)
- ~~send_money~~ (M-Pesa Send Money)

These are replaced by the unified wallet payment system using paybill 650880.
