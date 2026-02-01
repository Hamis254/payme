# M-Pesa Integration Analysis - PayMe Project

**Date:** February 1, 2026  
**Status:** ⚠️ **CRITICAL ISSUES FOUND**

---

## Executive Summary

The M-Pesa integration in PayMe has **significant architectural misalignment** between:
1. **Payment method onboarding** (stored in `payment_configs` table)
2. **Payment flow** (sales endpoints expecting payment config but not properly enforcing it)
3. **Frontend expectation** vs **backend reality**

**Critical Finding:** Users are prompted to setup payment methods, but there's **NO guarantee** these settings are used during the actual payment flow in many code paths.

---

## 1. Payment Method Onboarding ✅ (Working)

### Setup Flow
**Route:** `POST /api/payment-config/setup`

Users are correctly prompted to configure:
```javascript
{
  payment_method: 'till_number' | 'paybill',
  shortcode: string,        // M-Pesa shortcode
  passkey: string,          // Daraja passkey
  account_reference: string // Account ID
}
```

**Database:** `payment_configs` table stores per-business M-Pesa credentials.

**Status:** ✅ **WORKING CORRECTLY**
- Validation enforced via Zod schema
- Config is created and stored
- Can be updated/toggled

---

## 2. Sales Flow - CRITICAL ISSUES ⚠️

### A. PayMe Endpoint (Newer, Alternative Flow)
**Route:** `POST /api/payme`

#### Flow:
1. User sends cart items + `payment_mode` ('cash' or 'mpesa')
2. **ISSUE #1:** Controller reads `business.payment_method` from **businesses** table, NOT from `payment_configs`
3. Creates sale with status `'pending'` (for mpesa) or `'completed'` (for cash)
4. **DOES NOT initiate STK Push automatically** ❌

```javascript
// payme.controller.js - Line 95-105
if (payment_mode === 'mpesa') {
  const [business] = await db.select()
    .from(businesses)
    .where(and(eq(businesses.id, business_id), eq(businesses.user_id, req.user.id)))
    .limit(1);
  
  businessDetails = {
    payment_method: business.payment_method,        // ❌ From businesses table
    payment_identifier: business.payment_identifier, // ❌ Not from payment_configs
    business_name: business.name,
  };
}
```

#### Response:
```javascript
if (payment_mode === 'mpesa') {
  response.mpesa = {
    status: 'pending',
    customer_phone,
    amount: result.summary.total_amount,
    business_payment_method: businessDetails.payment_method,
    business_payment_identifier: businessDetails.payment_identifier,
    note: 'STK Push will be triggered with Safaricom Daraja API',  // ❌ Not triggered here!
  };
}
```

**Status:** ❌ **INCOMPLETE - STK Push NOT triggered**

---

### B. Sales Endpoint (Primary, Correct Flow)
**Route:** `POST /api/sales`

#### Flow:
1. Creates sale with status `'pending'`
2. Reserves 1 token from wallet
3. Returns sale ID (frontend must call next endpoint)

**Route:** `POST /api/sales/:id/pay/mpesa`

#### Flow:
1. Frontend passes customer phone + description
2. **Fetches payment config** from `payment_configs` table ✅
3. **Checks if config exists and is active** ✅
4. **Initiates STK Push using `initiateBusinessPayment()`** ✅
5. Stores payment initiation in `payments` table
6. Updates sale with `stk_request_id`

```javascript
// sales.controller.js - Line 282-312
const paymentConfig = await getPaymentConfig(sale.business_id);

if (!paymentConfig) {
  return res.status(400).json({
    error: 'Payment configuration not found. Please setup your M-Pesa credentials first.',
  });
}

if (!paymentConfig.is_active) {
  return res.status(400).json({
    error: 'Payment configuration is inactive.',
  });
}

const mpesaResp = await initiateBusinessPayment({
  paymentConfig,
  phone,
  amount: Number(sale.sale.total_amount),
  description: description || `PAYME Sale #${saleId}`,
});
```

**Status:** ✅ **CORRECT - STK Push IS triggered**

---

### C. M-Pesa Callback Handler
**Route:** `POST /api/sales/mpesa/callback` (PUBLIC - No Auth)

#### Flow:
1. Receives callback from Safaricom M-Pesa
2. Validates callback structure
3. Atomically processes payment:
   - If `ResultCode === 0` (Success):
     - Deducts stock using FIFO
     - Charges token from wallet
     - Marks sale as `'completed'`
   - If `ResultCode !== 0` (Failure):
     - Refunds reserved token
     - Marks sale as `'failed'`

**Status:** ✅ **CORRECT - Proper transaction handling**

---

## 3. M-Pesa Utility Functions ✅

### Function 1: `initiateTokenPurchase()`
**Purpose:** Token purchases (fixed wallet paybill)

Uses hardcoded:
- Paybill: `650880`
- Account: `37605544`

**Status:** ✅ **CORRECT**

---

### Function 2: `initiateBusinessPayment()`
**Purpose:** Customer payments for sales

Uses `paymentConfig` with fallback:
```javascript
const businessShortCode = paymentConfig?.shortcode || WALLET_PAYBILL;
const passKey = paymentConfig?.passkey || process.env.MPESA_PASSKEY;
const accountRef = paymentConfig?.account_reference || WALLET_ACCOUNT_REFERENCE;
```

**Status:** ✅ **CORRECT** (But fallback to wallet paybill is risky)

---

## 4. Stock Deduction Flow ✅

Payment completion triggers:
1. **FIFO stock deduction** using `deductStockFIFO()`
2. **Stock movement logging** for audit trail
3. **Profit calculation** (selling price - unit cost from FIFO batch)

**Status:** ✅ **CORRECT**

---

## CRITICAL ISSUES SUMMARY

### ⚠️ Issue #1: PayMe Endpoint Doesn't Enforce Payment Config
**Severity:** HIGH

The `/api/payme` endpoint:
- ❌ Does NOT check if business has payment config setup
- ❌ Does NOT enforce use of configured paybill/till
- ❌ Does NOT initiate STK Push
- ❌ Returns in-progress sale without payment trigger

**Frontend Impact:**
- If frontend uses `/api/payme`, customer receives NO STK Push
- Sale sits in `'pending'` state indefinitely
- User never gets prompted to pay

---

### ⚠️ Issue #2: Two Different Code Paths for Sales
**Severity:** MEDIUM

Developers have **two different sales endpoints**:
1. **`/api/payme`** - Incomplete (no STK)
2. **`/api/sales`** - Complete (with STK)

This causes confusion and potential misuse.

---

### ⚠️ Issue #3: Fallback to Wallet Paybill
**Severity:** MEDIUM

In `initiateBusinessPayment()`:
```javascript
const businessShortCode = paymentConfig?.shortcode || WALLET_PAYBILL;
```

If business doesn't have payment config:
- Payment goes to wallet paybill `650880`
- Customer receives wrong account number
- Transaction succeeds but business doesn't receive money
- **Silent failure**

---

### ⚠️ Issue #4: No Verification After Setup
**Severity:** LOW

After `POST /api/payment-config/setup`:
- Config is marked `verified: false`
- No verification workflow exists
- No testing of credentials
- Invalid configs accepted silently

---

## Recommended Flow for Frontend (CORRECT IMPLEMENTATION)

### Step 1: User Signs Up
```
POST /api/auth/signup
← Returns: setupNeeded: true, setupUrl: '/setup/payment-method'
```

### Step 2: User Sets Up Payment Method
```
POST /api/payment-config/setup
Body: {
  businessId,
  payment_method: 'till_number' | 'paybill',
  shortcode: '...',
  passkey: '...',
  account_reference: '...'
}
← Returns: Success confirmation
```

### Step 3: User Creates Sale
```
POST /api/sales
Body: {
  businessId,
  items: [{product_id, quantity, unit_price, unit_cost}],
  paymentMode: 'cash' | 'mpesa',
  customerName?: string,
  customerType?: 'walk_in' | 'credit' | 'hire_purchase',
  note?: string
}
← Returns: saleId, totalAmount
```

### Step 4: Initiate Payment (if mpesa)
```
POST /api/sales/{saleId}/pay/mpesa
Body: {
  phone: '+254...',
  description?: string
}
← Returns: checkoutRequestId (STK pushed to customer)
```

### Step 5: M-Pesa Callback (Automatic)
Customer completes M-Pesa prompt
→ Safaricom sends callback to backend
→ Stock deducted, tokens charged, sale completed

---

## FLOW COMPLIANCE CHECKLIST

| Requirement | Implemented? | Status |
|-------------|-------------|--------|
| **1. User prompted for payment method** | ✅ Yes | Via `/api/payment-config/setup` |
| **2. Payment method stored per business** | ✅ Yes | In `payment_configs` table |
| **3. STK push triggered for M-Pesa sales** | ⚠️ Partial | Only via `/api/sales` path, NOT via `/api/payme` |
| **4. Customer receives STK prompt** | ⚠️ Partial | If correct endpoint used |
| **5. Stock deducted on payment success** | ✅ Yes | Via callback handler |
| **6. Profit calculated correctly** | ✅ Yes | Using FIFO unit cost |
| **7. Tokens charged from wallet** | ✅ Yes | On sale completion |
| **8. Failed payments handled** | ✅ Yes | Token refunded |
| **9. Payment method verified** | ❌ No | Config never verified |
| **10. Fallback when no config** | ❌ Bad | Uses wallet paybill silently |

**Overall Score: 6.5/10** - Core functionality works but has critical gaps

---

## RECOMMENDATIONS

### 1. **URGENT: Remove or Fix `/api/payme` Endpoint** 
Choose one:

**Option A - Remove it:**
```javascript
// Delete routes/payme.routes.js
// Delete controllers/payme.controller.js
// Use only /api/sales flow
```

**Option B - Fix it to complete the flow:**
```javascript
// payme.controller.js - processPayMe()
if (payment_mode === 'mpesa') {
  const paymentConfig = await getPaymentConfig(business_id);
  
  if (!paymentConfig) {
    return res.status(400).json({
      error: 'Payment method not configured',
      setupUrl: '/setup/payment-method'
    });
  }
  
  // Initiate STK push immediately
  const mpesaResp = await initiateBusinessPayment({
    paymentConfig,
    phone: customer_phone,
    amount: result.summary.total_amount,
    description: `PAYME Sale #${result.sale.id}`
  });
  
  response.mpesa.checkoutRequestId = mpesaResp.CheckoutRequestID;
  response.mpesa.status = 'initiated'; // Not 'pending'
}
```

### 2. **Add Payment Config Verification**
```javascript
// paymentConfig.service.js
export const verifyPaymentConfig = async (configId) => {
  // Test credentials with M-Pesa test endpoint
  // Mark verified: true only if credentials valid
};
```

### 3. **Remove Fallback to Wallet Paybill**
```javascript
// mpesa.js - initiateBusinessPayment()
if (!paymentConfig || !paymentConfig.is_active) {
  throw new Error('Payment configuration required - no fallback allowed');
}
```

### 4. **Add Debug Logging**
Track which code path is being used:
```javascript
logger.info('Using payment config', {
  configId: paymentConfig.id,
  shortcode: paymentConfig.shortcode,
  method: paymentConfig.payment_method
});
```

### 5. **Document Both Flows Clearly**
- Create separate documentation for `/api/sales` (recommended)
- Mark `/api/payme` as (deprecated/experimental)
- Provide migration guide if needed

---

## CONCLUSION

### Current Status
**M-Pesa integration is 70% complete:**
- ✅ Payment method setup works
- ✅ Core payment flow works (via `/api/sales` path)
- ✅ Callback handling is robust
- ❌ Alternative `/api/payme` path is incomplete
- ❌ No verification of payment credentials
- ⚠️ Risky fallback to wallet paybill

### To Make It Production-Ready
1. **Remove or completely fix `/api/payme` endpoint** (MUST)
2. **Add payment config verification** (SHOULD)
3. **Remove silent fallbacks** (SHOULD)
4. **Document the correct flow clearly** (MUST)

### For Frontend Implementation
**Use ONLY this flow:**
```
/api/sales → /api/sales/{id}/pay/mpesa → M-Pesa Callback → Complete
```

**DO NOT use `/api/payme` for M-Pesa** - it doesn't initiate payment.
