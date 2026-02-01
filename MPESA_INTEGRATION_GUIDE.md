# M-Pesa Payment Method Setup - Integration Guide

## Architecture Overview

This restructuring separates M-Pesa payment handling into two independent systems:

### System 1: Wallet Token Purchases (Unchanged)
- **What**: Users buy tokens to reserve for sales
- **Paybill**: 650880 (hardcoded)
- **Account**: 37605544 (hardcoded)
- **Credentials**: MPESA_PASSKEY_WALLET in `.env`
- **Function**: `initiateStkPush(product='tokens', ...)`
- **Status**: ✅ Working - Do not modify

### System 2: Business Customer Payments (New)
- **What**: Customers pay for sales via business's paybill/till
- **Paybill/Till**: Per-business, stored in `payment_configs` table
- **Credentials**: Stored in database per business
- **Setup**: After user signup, redirect to payment config setup
- **Function**: `initiateBusinessStkPush(paymentConfig, ...)`
- **Status**: ✅ New implementation

---

## Step-by-Step Integration

### Step 1: Database Migration

Generate and apply the new `payment_configs` table:

```bash
npm run db:generate
npm run db:migrate
```

This creates:
```sql
CREATE TABLE payment_configs (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  payment_method VARCHAR(20) NOT NULL,
  shortcode VARCHAR(20) NOT NULL,
  passkey TEXT NOT NULL,
  account_reference VARCHAR(12) NOT NULL,
  account_name VARCHAR(255),
  verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Step 2: Update Environment Variables

**Remove** from `.env`:
```env
MPESA_SHORTCODE_PAYBILL=  # ❌ DELETE
MPESA_PASSKEY_PAYBILL=    # ❌ DELETE
MPESA_SHORTCODE_TILL=     # ❌ DELETE
MPESA_PASSKEY_TILL=       # ❌ DELETE
```

**Keep** in `.env`:
```env
# Shared OAuth credentials
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...

# Wallet payments only
MPESA_PASSKEY_WALLET=...    # For paybill 650880
MPESA_CALLBACK_URL=...

# B2C (optional)
MPESA_B2C_SHORTCODE=...
MPESA_B2C_INITIATOR=...
```

### Step 3: Verify File Structure

New files created:
```
✅ src/models/paymentConfig.model.js          - Database model
✅ src/services/paymentConfig.service.js      - Business logic
✅ src/controllers/paymentConfig.controller.js - HTTP handlers
✅ src/validations/paymentConfig.validation.js - Zod schemas
✅ src/routes/paymentConfig.routes.js         - API routes
✅ src/utils/mpesa.js                         - UPDATED with initiateBusinessStkPush()
✅ src/controllers/auth.controller.js         - UPDATED with setupNeeded flag
```

### Step 4: Understand the Signup Flow

**Current Auth Response:**
```json
{
  "message": "User registered",
  "user": { ... },
  "setupNeeded": true,
  "setupUrl": "/setup/payment-method"
}
```

**Frontend Action:**
1. After signup, check `setupNeeded === true`
2. Redirect to: `POST /api/payment-config/setup`
3. User selects payment method (paybill or till)
4. User provides Daraja credentials
5. Created in `payment_configs` table

### Step 5: Using Payment Configs in Sales

**Old Way** (Hardcoded - REMOVE):
```javascript
const { initiateStkPush } = require('#utils/mpesa');

// This will fail for business payments now
initiateStkPush({
  product: 'paybill',  // ❌ NO LONGER WORKS
  phone,
  amount,
})
```

**New Way** (Database-driven):
```javascript
import { initiateStkPush, initiateBusinessStkPush } from '#utils/mpesa';
import { getPaymentConfig } from '#services/paymentConfig.service';

// For wallet tokens (unchanged):
await initiateStkPush({
  product: 'tokens',
  phone,
  amount,
  accountReference: 'TOKEN-PURCHASE',
  description,
});

// For business customers (NEW):
const paymentConfig = await getPaymentConfig(businessId);

if (!paymentConfig) {
  throw new Error('Business has not configured payment method');
}

await initiateBusinessStkPush({
  paymentConfig,  // Contains: shortcode, passkey, account_reference
  phone,
  amount,
  description,
});
```

---

## API Endpoints

### Payment Configuration Setup (Post-signup)

```http
POST /api/payment-config/setup
Content-Type: application/json
Authorization: Bearer <JWT>

{
  "businessId": 1,
  "payment_method": "paybill",
  "shortcode": "123456",
  "passkey": "YOUR_DARAJA_PASSKEY",
  "account_reference": "ACC001",
  "account_name": "My Shop"
}

Response:
{
  "success": true,
  "message": "Payment method configured successfully",
  "config": {
    "id": 1,
    "business_id": 1,
    "payment_method": "paybill",
    "shortcode": "123456",
    "account_reference": "ACC001",
    "verified": false,
    "is_active": true
  }
}
```

### Get Payment Configuration

```http
GET /api/payment-config/:businessId
Authorization: Bearer <JWT>

Response:
{
  "success": true,
  "config": { ... }
}
```

### Update Payment Configuration

```http
PATCH /api/payment-config/:configId
Authorization: Bearer <JWT>

{
  "passkey": "NEW_PASSKEY",
  "account_reference": "NEW_REF",
  "is_active": true
}
```

### Toggle Configuration Status

```http
POST /api/payment-config/:configId/toggle
Authorization: Bearer <JWT>

{
  "is_active": false
}
```

---

## Code Examples

### Example 1: Customer Payment (Sales)

```javascript
import { initiateBusinessStkPush } from '#utils/mpesa';
import { getPaymentConfig } from '#services/paymentConfig.service';

export const initiateCustomerPayment = async (req, res) => {
  try {
    const { businessId, phone, amount, description } = req.body;

    // ✅ Fetch business-specific payment config
    const paymentConfig = await getPaymentConfig(businessId);

    if (!paymentConfig) {
      return res.status(400).json({
        error: 'Business has not configured payment method. Setup required.',
        setupUrl: `/setup/payment-method/${businessId}`
      });
    }

    // ✅ Initiate STK push with business's credentials
    const result = await initiateBusinessStkPush({
      paymentConfig,
      phone,
      amount,
      description,
    });

    return res.status(201).json({
      success: true,
      checkoutRequestId: result.CheckoutRequestID,
    });
  } catch (e) {
    logger.error('Error initiating customer payment', e);
    next(e);
  }
};
```

### Example 2: Business Setting Up Payment

```javascript
// User creates account:
POST /api/auth/sign-up
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "...",
  "phone_number": "+254712345678"
}

Response:
{
  "message": "User registered",
  "setupNeeded": true,
  "setupUrl": "/setup/payment-method",
  "user": { ... }
}

// Frontend redirects to payment config setup
// User selects payment method and enters credentials:

POST /api/payment-config/setup
{
  "businessId": 1,
  "payment_method": "till",
  "shortcode": "174379",
  "passkey": "abc123xyz",
  "account_reference": "SHOP001",
  "account_name": "My Till"
}
```

### Example 3: Wallet Token Purchase (Unchanged)

```javascript
import { initiateStkPush } from '#utils/mpesa';

export const buyTokens = async (req, res) => {
  try {
    const { phone, amount } = req.body;

    // ✅ Still uses wallet paybill 650880
    const result = await initiateStkPush({
      product: 'tokens',
      phone,
      amount,
      accountReference: 'TOKEN-PURCHASE',
      description: 'Token purchase',
    });

    return res.status(201).json({ success: true, ... });
  } catch (e) {
    next(e);
  }
};
```

---

## Security Considerations

### 1. Passkey Encryption
Consider encrypting passpeys in database:
```javascript
// In paymentConfig.service.js
import { encrypt, decrypt } from '#utils/encryption';

// On create
passkey: encrypt(passkey),

// On use
const decrypted = decrypt(config.passkey);
```

### 2. Verification Status
Track if business has been verified with Safaricom:
```javascript
config.verified === false  // Not yet verified
config.verified === true   // Tested and working
```

### 3. Access Control
Always verify user owns the business before operations:
```javascript
const [business] = await db
  .select()
  .from(businesses)
  .where(
    and(
      eq(businesses.id, businessId),
      eq(businesses.user_id, userId)
    )
  );

if (!business) throw new Error('Access denied');
```

---

## Testing Checklist

- [ ] Database migration applies cleanly
- [ ] Auth signup returns `setupNeeded: true`
- [ ] User can POST to `/api/payment-config/setup`
- [ ] Payment config is stored in database
- [ ] GET `/api/payment-config/:businessId` returns config
- [ ] PATCH updates passkey/account reference
- [ ] POST toggle changes `is_active` status
- [ ] Wallet token purchase still uses paybill 650880
- [ ] Business customer payment uses configured paybill/till
- [ ] M-Pesa STK push succeeds with business credentials
- [ ] Callback handling works for both wallet and business payments

---

## Rollback Instructions

If needed to revert:

```bash
# Undo migration
npm run db:migrate -- --down

# Remove new files
rm src/models/paymentConfig.model.js
rm src/services/paymentConfig.service.js
rm src/controllers/paymentConfig.controller.js
rm src/validations/paymentConfig.validation.js
rm src/routes/paymentConfig.routes.js

# Restore .env variables:
echo "MPESA_SHORTCODE_PAYBILL=..." >> .env
echo "MPESA_PASSKEY_PAYBILL=..." >> .env
echo "MPESA_SHORTCODE_TILL=..." >> .env
echo "MPESA_PASSKEY_TILL=..." >> .env
```

---

## Support

This structure ensures:
- ✅ Wallet payments (tokens) are independent from business payments
- ✅ Each business manages their own M-Pesa credentials
- ✅ No hardcoded paybill/till in environment
- ✅ Professional, scalable architecture
- ✅ mpesa.controller.js, timestamp.js, token generator remain unchanged
