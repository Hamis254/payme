# Wallet API Documentation

## Overview

The Wallet API provides a complete token management system for businesses. Tokens are used to process sales transactions, with 1 token required per sale. All token purchases are centralized through a dedicated M-Pesa paybill number for streamlined payment processing.

## Token Economics

- **Retail Price**: 1 token = 2 KES
- **Package Discounts**: Available for bulk purchases
- **Usage**: 1 token consumed per completed sale

### Token Packages

| Package | Tokens | Price (KES) | Price/Token | Savings vs Retail |
| ------- | ------ | ----------- | ----------- | ----------------- |
| 30      | 30     | 50          | 1.67        | 10 KES (16.7%)    |
| 70      | 70     | 100         | 1.43        | 40 KES (28.6%)    |
| 150     | 150    | 200         | 1.33        | 100 KES (33.3%)   |
| 400     | 400    | 500         | 1.25        | 300 KES (37.5%)   |
| 850     | 850    | 1000        | 1.18        | 700 KES (41.2%)   |

## API Endpoints

### Public Endpoints (No Authentication Required)

#### Get Available Token Packages

```
GET /api/wallet/packages
```

**Response:**

```json
{
  "message": "Token packages retrieved successfully",
  "packages": [
    {
      "packageType": "30",
      "tokens": 30,
      "price": 50,
      "pricePerToken": "1.67",
      "savings": 10,
      "savingsPercent": "16.7"
    }
  ],
  "retailPrice": {
    "perToken": 2,
    "currency": "KES"
  }
}
```

#### M-Pesa Callback (Token Purchase)

```
POST /api/wallet/callback/token-purchase
```

This endpoint receives payment confirmations from M-Pesa. It's called automatically by Safaricom.

---

### Authenticated Endpoints (Require JWT Token)

#### Get Wallet Balance

```
GET /api/wallet/business/:businessId
```

**Response:**

```json
{
  "message": "Wallet balance retrieved successfully",
  "wallet": {
    "businessId": 1,
    "balanceTokens": 150,
    "createdAt": "2026-01-25T10:00:00Z",
    "updatedAt": "2026-01-25T15:30:00Z"
  },
  "tokenValue": {
    "tokens": 150,
    "estimatedValueKES": 300
  }
}
```

#### Initiate Token Purchase

```
POST /api/wallet/purchase
```

**Request Body:**

```json
{
  "businessId": 1,
  "packageType": "70",
  "phone": "+254712345678"
}
```

**Response:**

```json
{
  "message": "Token purchase initiated. Please complete payment on your phone.",
  "purchase": {
    "purchaseId": 42,
    "packageType": "70",
    "tokens": 70,
    "amount": 100,
    "currentBalance": 30
  },
  "mpesa": {
    "checkoutRequestId": "ws_CO_25012026153045678901",
    "status": "pending",
    "instruction": "Check your phone for M-Pesa payment prompt"
  }
}
```

#### Get Wallet Transactions

```
GET /api/wallet/business/:businessId/transactions?type=all&limit=50&offset=0
```

**Query Parameters:**

- `type` (optional): Filter by transaction type
  - `all` (default)
  - `purchase` - Token purchases
  - `reserve` - Sale token reservations
  - `charge` - Completed sale charges
  - `refund` - Failed sale refunds
- `limit` (optional): Number of results (max 100, default 50)
- `offset` (optional): Pagination offset (default 0)

**Response:**

```json
{
  "message": "Transactions retrieved successfully",
  "transactions": [
    {
      "id": 123,
      "business_id": 1,
      "change_tokens": 70,
      "type": "purchase",
      "reference": "42",
      "note": "Token purchase - 70 package",
      "created_at": "2026-01-25T15:30:00Z"
    },
    {
      "id": 124,
      "business_id": 1,
      "change_tokens": -1,
      "type": "charge",
      "reference": "SALE-456",
      "note": "Sale completed",
      "created_at": "2026-01-25T16:00:00Z"
    }
  ],
  "pagination": {
    "count": 2,
    "offset": 0,
    "limit": 50,
    "hasMore": false
  }
}
```

#### Get Token Purchase History

```
GET /api/wallet/business/:businessId/purchases?status=all&limit=20
```

**Query Parameters:**

- `status` (optional): Filter by status
  - `all` (default)
  - `pending`
  - `success`
  - `failed`
- `limit` (optional): Number of results (max 100, default 20)

**Response:**

```json
{
  "message": "Purchase history retrieved successfully",
  "purchases": [
    {
      "id": 42,
      "business_id": 1,
      "package_type": "70",
      "tokens_purchased": 70,
      "amount_paid": "100.00",
      "payment_method": "mpesa",
      "mpesa_transaction_id": "QGT6Y7Z8X9",
      "mpesa_phone": "254712345678",
      "status": "success",
      "created_at": "2026-01-25T15:28:00Z",
      "completed_at": "2026-01-25T15:30:00Z"
    }
  ],
  "summary": {
    "totalPurchases": 1,
    "totalTokensPurchased": 70,
    "totalAmountPaid": 100
  }
}
```

---

### Admin-Only Endpoints (Require Admin Role)

#### Manually Add Tokens

```
POST /api/wallet/admin/add-tokens
```

**Request Body:**

```json
{
  "businessId": 1,
  "tokens": 100,
  "note": "Promotional tokens",
  "paymentMethod": "admin"
}
```

**Payment Methods:**

- `cash` - Cash payment received
- `bank_transfer` - Bank transfer
- `admin` - Admin grant/promotion

**Response:**

```json
{
  "message": "Tokens added successfully",
  "wallet": {
    "businessId": 1,
    "tokensAdded": 100,
    "newBalance": 230,
    "paymentMethod": "admin"
  },
  "transaction": {
    "amount": 200,
    "note": "Promotional tokens"
  }
}
```

## M-Pesa Integration

### Centralized Payment Collection

All token purchases use a **dedicated paybill number** configured via:

```env
MPESA_TOKENS_PAYBILL=123456
MPESA_TOKENS_PASSKEY=your_lipa_na_mpesa_passkey
```

If not configured, falls back to the default paybill:

```env
MPESA_SHORTCODE_PAYBILL=123456
MPESA_PASSKEY_PAYBILL=your_passkey
```

### Payment Flow

1. **Initiation**: User calls `/api/wallet/purchase`
2. **STK Push**: System sends M-Pesa prompt to user's phone
3. **User Payment**: User enters PIN on phone
4. **Callback**: M-Pesa calls `/api/wallet/callback/token-purchase`
5. **Processing**: System updates wallet and purchase status
6. **Completion**: Tokens added to business wallet

### Error Handling

The system gracefully handles:

- Payment cancellations (ResultCode ≠ 0)
- Duplicate callbacks (idempotency check)
- Network failures (automatic retries by M-Pesa)
- Invalid callbacks (schema validation)

## Token Lifecycle

### Purchase

```
User initiates purchase → STK Push sent → Payment completed
→ Tokens added to wallet → Transaction logged
```

### Sale Flow

```
Sale created → 1 token reserved → Stock deducted (if cash)
→ Payment confirmed → Token charged → Sale completed
```

### Refund (Failed Sale)

```
Sale fails/cancelled → Token refunded to wallet
→ Refund transaction logged
```

## Environment Variables

Required for wallet functionality:

```env
# M-Pesa Credentials
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_ENV=sandbox  # or 'production'

# Dedicated Token Paybill (Centralized)
MPESA_TOKENS_PAYBILL=123456
MPESA_TOKENS_PASSKEY=your_lipa_na_mpesa_passkey

# Callbacks
MPESA_CALLBACK_URL=https://yourdomain.com/api/wallet/callback/token-purchase

# Fallback (if tokens paybill not configured)
MPESA_SHORTCODE_PAYBILL=654321
MPESA_PASSKEY_PAYBILL=fallback_passkey
```

## Best Practices

### For Developers

1. **Always check wallet balance** before creating sales
2. **Use transactions** for token operations (reserve → charge/refund)
3. **Log all token movements** for audit trails
4. **Handle M-Pesa callbacks idempotently**
5. **Return 200 OK** to all M-Pesa callbacks (even on errors)

### For Frontend Integration

1. **Show real-time balance** after each transaction
2. **Poll purchase status** after initiating M-Pesa payment
3. **Display package savings** prominently
4. **Provide transaction history** for transparency
5. **Handle pending states** gracefully (payment in progress)

### Security

1. **Authenticate all endpoints** except callbacks and packages
2. **Validate business ownership** before showing balances
3. **Admin-only token grants** require `admin` role
4. **Rate limit** purchase endpoints to prevent abuse
5. **Log all operations** for security auditing

## Testing

### Sandbox Testing

Use Safaricom's test credentials:

- Test Phone: `254708374149`
- Test PIN: `0000`

### Example cURL Requests

**Get Packages:**

```bash
curl https://yourdomain.com/api/wallet/packages
```

**Get Balance:**

```bash
curl -H "Cookie: token=YOUR_JWT_TOKEN" \
  https://yourdomain.com/api/wallet/business/1
```

**Purchase Tokens:**

```bash
curl -X POST \
  -H "Cookie: token=YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"businessId":1,"packageType":"70","phone":"+254712345678"}' \
  https://yourdomain.com/api/wallet/purchase
```

## Monitoring & Alerts

### Key Metrics to Track

- Token purchase success rate
- Average response time for STK Push
- Failed payment rate
- Callback processing time
- Wallet balance trends

### Recommended Alerts

- Failed callbacks > 5% in 1 hour
- STK Push timeout > 30 seconds
- Wallet balance < 10 tokens (low balance warning)
- Multiple failed purchases for same business

## Support

For issues or questions:

- Check logs in `logs/combined.log` and `logs/error.log`
- Review M-Pesa integration status in Safaricom portal
- Verify callback URL is publicly accessible
- Ensure environment variables are configured correctly
