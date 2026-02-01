# M-Pesa Environment Variables Restructuring

## Overview

PayMe now separates M-Pesa credentials into two distinct categories:

### 1. **Wallet Payments** (System-wide)
- Fixed paybill: **650880**
- Fixed account: **37605544**
- Used when users buy tokens to reserve for sales
- Configured ONCE in `.env`

### 2. **Business Customer Payments** (Per-business)
- Each business configures their own paybill OR till number
- Stored in `payment_configs` database table
- User sets up during onboarding after signup
- No hardcoded till/paybill credentials in `.env`

---

## Required Environment Variables

### Shared M-Pesa Credentials
Used for ALL M-Pesa API calls (OAuth token generation).

```env
# Safaricom Daraja API credentials
# Shared across wallet and business payments
# Get from: https://developer.safaricom.co.ke
MPESA_CONSUMER_KEY=AlE9CcAjOWv525kpWbObjVZBKF1y6Q6XY1gxCJ5L3nQ7s6if
MPESA_CONSUMER_SECRET=YOUR_SECRET_KEY

# M-Pesa Environment: sandbox or production
# Default: sandbox
MPESA_ENV=sandbox
```

### Wallet Payment Credentials
ONLY for token purchases via wallet (system-wide fixed).

```env
# Wallet token purchase configuration
# Paybill: 650880 (hardcoded)
# Account: 37605544 (hardcoded)
# Passkey from Daraja portal for paybill 650880
MPESA_PASSKEY_WALLET=YOUR_WALLET_PASSKEY_FROM_DARAJA

# M-Pesa callback URL for all STK push responses
MPESA_CALLBACK_URL=https://yourdomain.com/api/mpesa/callback
```

### B2C Payout Credentials (Optional)
For wallet withdrawals or business payouts (future feature).

```env
# B2C payout configuration (if enabled)
MPESA_B2C_SHORTCODE=YOUR_B2C_SHORTCODE
MPESA_B2C_INITIATOR=apiop
MPESA_B2C_SECURITY_CREDENTIAL=YOUR_B2C_SECURITY_CREDENTIAL
MPESA_B2C_TIMEOUT_URL=https://yourdomain.com/api/mpesa/b2c/timeout
MPESA_B2C_RESULT_URL=https://yourdomain.com/api/mpesa/b2c/result
```

---

## NO LONGER NEEDED

Remove these from `.env` (credentials now stored per-business in database):

```env
# REMOVE THESE - Moved to database payment_configs table
MPESA_SHORTCODE_PAYBILL=  ← REMOVE (per-business now)
MPESA_PASSKEY_PAYBILL=    ← REMOVE (per-business now)
MPESA_SHORTCODE_TILL=     ← REMOVE (per-business now)
MPESA_PASSKEY_TILL=       ← REMOVE (per-business now)
```

---

## Example Complete .env Setup

```env
# Database
DATABASE_URL=postgresql://user:pass@neon.tech/payme

# JWT
JWT_SECRET=your_jwt_secret_key

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# ============ M-PESA CONFIGURATION ============

# Shared Daraja API Credentials (ALL payment types use these for OAuth)
MPESA_CONSUMER_KEY=AlE9CcAjOWv525kpWbObjVZBKF1y6Q6XY1gxCJ5L3nQ7s6if
MPESA_CONSUMER_SECRET=YOUR_SECRET_KEY
MPESA_ENV=sandbox

# Wallet Token Purchases (Fixed: 650880 paybill, 37605544 account)
MPESA_PASSKEY_WALLET=YOUR_WALLET_PASSKEY
MPESA_CALLBACK_URL=https://yourdomain.com/api/mpesa/callback

# B2C Payouts (Optional)
MPESA_B2C_SHORTCODE=600000
MPESA_B2C_INITIATOR=apiop
MPESA_B2C_SECURITY_CREDENTIAL=YOUR_B2C_CRED
MPESA_B2C_TIMEOUT_URL=https://yourdomain.com/api/mpesa/b2c/timeout
MPESA_B2C_RESULT_URL=https://yourdomain.com/api/mpesa/b2c/result

# Arcjet
ARCJET_KEY=your_arcjet_key
```

---

## Data Flow: After User Signup

### 1. User Signs Up
```
POST /api/auth/sign-up
→ Creates user
→ Returns { user, setupNeeded: true }
```

### 2. Frontend Redirects to Payment Setup
```
Redirect to: /setup/payment-method/:businessId
```

### 3. User Selects & Configures Payment Method
```
POST /api/payment-config/setup
{
  "businessId": 1,
  "payment_method": "paybill",        // or "till"
  "shortcode": "123456",               // their paybill/till
  "passkey": "PASSKEY_FROM_DARAJA",   // from Daraja portal
  "account_reference": "ACC001",      // max 12 chars
  "account_name": "My Business"        // optional
}
→ Creates entry in payment_configs table
```

### 4. User Can Buy Tokens (Uses Wallet Paybill)
```
POST /api/wallet-payment/initiate
→ Calls initiateStkPush(product='tokens')
→ Uses MPESA_PASSKEY_WALLET from .env
→ Routes to hardcoded paybill 650880
```

### 5. Customer Makes Payment (Uses Business Config)
```
POST /api/sales/initiate
→ Gets payment_config from database
→ Calls initiateBusinessStkPush(paymentConfig)
→ Uses business's configured till/paybill
→ Routes to customer's configured shortcode
```

---

## Summary Table

| Feature | Wallet Tokens | Business Payments |
|---------|--------------|------------------|
| **Paybill/Till** | Fixed: 650880 | Per-business in DB |
| **Account** | Fixed: 37605544 | Per-business in DB |
| **Passkey Location** | `.env` MPESA_PASSKEY_WALLET | `payment_configs` table |
| **Setup** | Once in .env | During onboarding |
| **Daraja API** | OAuth via CONSUMER_KEY/SECRET | OAuth via CONSUMER_KEY/SECRET |
| **User Action** | Buy tokens | Set up after signup |
| **Function** | `initiateStkPush(product='tokens')` | `initiateBusinessStkPush(paymentConfig)` |

---

## Migration Checklist

- [ ] Update `.env` - remove MPESA_SHORTCODE_* and MPESA_PASSKEY_PAYBILL/TILL
- [ ] Keep MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET (shared OAuth)
- [ ] Add/verify MPESA_PASSKEY_WALLET (wallet paybill 650880)
- [ ] Run `npm run db:generate` to create migration for `paymentConfigs` table
- [ ] Run `npm run db:migrate` to apply migration
- [ ] Update auth signup response to include `setupNeeded: true`
- [ ] Create payment-config routes
- [ ] Update sales controller to fetch business payment config from DB
- [ ] Test wallet token purchase (uses paybill 650880)
- [ ] Test business customer payment (uses per-business paybill/till)
