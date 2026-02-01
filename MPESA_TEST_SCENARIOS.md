# M-Pesa Integration - Test Scenarios & Validation

## Test Environment Setup

### Prerequisites
- Test M-Pesa account with Safaricom Daraja sandbox credentials
- Test phone number (254712345678 or similar)
- Test database with sample data
- Postman or similar API testing tool
- Browser for M-Pesa prompt simulation

---

## Test Scenario 1: Payment Configuration Setup ✅

### Test Case 1.1: Setup Till Number Configuration
**Endpoint:** `POST /api/payment-config/setup`

**Setup:**
- User signed up and authenticated
- User has created a business

**Request:**
```json
{
  "businessId": 1,
  "payment_method": "till_number",
  "shortcode": "600980",
  "passkey": "bfb279f9aa9bdbcf158e97dd1a503b00",
  "account_reference": "ACME123",
  "account_name": "ACME Store"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Payment method configured successfully",
  "config": {
    "id": 1,
    "business_id": 1,
    "payment_method": "till_number",
    "shortcode": "600980",
    "account_reference": "ACME123",
    "account_name": "ACME Store",
    "verified": false,
    "is_active": true
  }
}
```

**Validation:**
- ✅ Config created in database
- ✅ `verified: false` (not yet tested)
- ✅ `is_active: true` (ready to use)
- ✅ All fields stored correctly

---

### Test Case 1.2: Setup Paybill Configuration
**Endpoint:** `POST /api/payment-config/setup`

**Request:**
```json
{
  "businessId": 2,
  "payment_method": "paybill",
  "shortcode": "900800",
  "passkey": "abc123def456",
  "account_reference": "SHOP456",
  "account_name": "Main Shop Paybill"
}
```

**Expected Response:** Similar to 1.1

**Validation:**
- ✅ Paybill config created
- ✅ Correct transaction type will be used (CustomerPayBillOnline vs CustomerBuyGoodsOnline)

---

### Test Case 1.3: Cannot Setup Duplicate Config
**Endpoint:** `POST /api/payment-config/setup`

**Setup:** Business 1 already has a config

**Request:** Try to setup another config for business 1

**Expected Response:**
```json
{
  "error": "Payment configuration already exists. Use update instead."
}
```

**Validation:**
- ✅ Duplicate prevention works
- ✅ User directed to use update endpoint

---

### Test Case 1.4: Verify Payment Configuration (NEW)
**Endpoint:** `POST /api/payment-config/:configId/verify`

**Setup:** Config exists but `verified: false`

**Request:**
```
POST /api/payment-config/1/verify
```

**Expected Response (if credentials valid):**
```json
{
  "success": true,
  "message": "Payment configuration verified successfully",
  "config": {
    "id": 1,
    "verified": true,
    "payment_method": "till_number",
    "shortcode": "600980"
  }
}
```

**Expected Response (if credentials invalid):**
```json
{
  "error": "Invalid M-Pesa credentials",
  "message": "Configuration verification failed"
}
```

**Validation:**
- ✅ Credentials are tested with Safaricom
- ✅ `verified: true` only if test passes
- ✅ Clear error messages if invalid

---

## Test Scenario 2: Create Sale (Both Flows)

### Test Case 2.1: Create Sale with Intention to Pay Cash
**Endpoint:** `POST /api/sales`

**Setup:**
- User authenticated
- Business exists with payment config
- Products exist in inventory with stock

**Request:**
```json
{
  "businessId": 1,
  "items": [
    {
      "product_id": 1,
      "quantity": 5,
      "unit_price": 100,
      "unit_cost": 50
    },
    {
      "product_id": 2,
      "quantity": 3,
      "unit_price": 200,
      "unit_cost": 120
    }
  ],
  "paymentMode": "cash",
  "customerName": "John Doe",
  "customerType": "walk_in"
}
```

**Expected Response:**
```json
{
  "message": "Sale created successfully",
  "saleId": 100,
  "totalAmount": 1100,
  "tokenFee": 1,
  "tokens_remaining": 9
}
```

**Validation:**
- ✅ Sale created with status 'pending'
- ✅ Sale items inserted
- ✅ 1 token reserved from wallet
- ✅ Total amount correct (5*100 + 3*200 = 1100)
- ✅ Profit tracked (5*50 + 3*80 = 490)
- ✅ Stock not yet deducted (will be on cash payment)

---

### Test Case 2.2: Create Sale with Intention to Pay M-Pesa
**Endpoint:** `POST /api/sales`

**Request:**
```json
{
  "businessId": 1,
  "items": [
    {
      "product_id": 1,
      "quantity": 2,
      "unit_price": 100,
      "unit_cost": 50
    }
  ],
  "paymentMode": "mpesa",
  "customerName": "Jane Smith",
  "customerType": "walk_in"
}
```

**Expected Response:**
```json
{
  "message": "Sale created successfully",
  "saleId": 101,
  "totalAmount": 200,
  "tokenFee": 1,
  "tokens_remaining": 8
}
```

**Validation:**
- ✅ Sale status 'pending'
- ✅ Payment status 'pending'
- ✅ 1 token reserved
- ✅ stk_request_id: null (not initiated yet)

---

### Test Case 2.3: Create Sale Without Stock
**Endpoint:** `POST /api/sales`

**Setup:** Product has only 2 units in stock

**Request:** Try to sell 5 units

**Expected Response:**
```json
{
  "error": "Insufficient stock for product ID 1",
  "available": 2,
  "requested": 5
}
```

**Validation:**
- ✅ Stock validation works
- ✅ Sale not created
- ✅ No token reserved
- ✅ Clear error message

---

## Test Scenario 3: Cash Payment

### Test Case 3.1: Pay for Sale with Cash
**Endpoint:** `POST /api/sales/100/pay/cash`

**Setup:** Sale 100 exists with status 'pending'

**Request:**
```
POST /api/sales/100/pay/cash
```

**Expected Response:**
```json
{
  "message": "Payment completed successfully",
  "saleId": 100
}
```

**Database Validation:**
- ✅ Sale status: 'completed'
- ✅ Payment status: 'success'
- ✅ amount_paid: '1100'
- ✅ Stock deducted from inventory
- ✅ Stock movements logged (FIFO deductions)
- ✅ Payment record created

---

## Test Scenario 4: M-Pesa Payment Flow (The Critical One!)

### Test Case 4.1: Initiate M-Pesa Payment (STK Push)
**Endpoint:** `POST /api/sales/101/pay/mpesa`

**Setup:** Sale 101 exists with payment_mode 'mpesa', status 'pending'

**Request:**
```json
{
  "phone": "254712345678",
  "description": "Sale for John's store"
}
```

**Expected Response:**
```json
{
  "message": "M-Pesa payment initiated",
  "saleId": 101,
  "checkoutRequestId": "ws_CO_DMZ_123456789"
}
```

**Database State After:**
- ✅ Sale.stk_request_id: 'ws_CO_DMZ_123456789'
- ✅ Sale.payment_status: 'initiated'
- ✅ Payment record created with status 'initiated'
- ✅ checkoutRequestId stored

**Frontend Behavior:**
- ✅ STK PUSH appears on customer's phone
- ✅ "Enter MPESA PIN to pay 200 KSH to ACME Store (ACME123)"
- ✅ Customer enters PIN

---

### Test Case 4.2: Handle M-Pesa Callback - Success
**Endpoint:** `POST /api/sales/mpesa/callback` (PUBLIC)

**From:** Safaricom (when customer completes payment)

**Request:**
```json
{
  "Body": {
    "stkCallback": {
      "CheckoutRequestID": "ws_CO_DMZ_123456789",
      "ResultCode": 0,
      "ResultDesc": "The service request has been processed successfully.",
      "CallbackMetadata": {
        "Item": [
          {
            "Name": "Amount",
            "Value": 200
          },
          {
            "Name": "MpesaReceiptNumber",
            "Value": "PUE123ABC"
          },
          {
            "Name": "PhoneNumber",
            "Value": "254712345678"
          },
          {
            "Name": "TransactionDate",
            "Value": "20260201120530"
          }
        ]
      }
    }
  }
}
```

**Expected Response:**
```json
{
  "status": "ok"
}
```

**Database State After:**
- ✅ Sale status: 'completed'
- ✅ Sale payment_status: 'success'
- ✅ mpesa_transaction_id: 'PUE123ABC'
- ✅ mpesa_sender_phone: '254712345678'
- ✅ amount_paid: '200'
- ✅ callback_processed: true
- ✅ Stock deducted (FIFO)
- ✅ Token charged from wallet
- ✅ Wallet balance updated
- ✅ Payment record status: 'success'
- ✅ Stock movements logged

**Validation:**
- ✅ Stock deduction is correct (2 units from product 1)
- ✅ FIFO unit cost used (50 KSH per unit)
- ✅ Profit calculated (2 * (100-50) = 100)
- ✅ Token charged (1 token from wallet)
- ✅ Transaction atomic (all or nothing)

---

### Test Case 4.3: Handle M-Pesa Callback - Failure
**Endpoint:** `POST /api/sales/mpesa/callback` (PUBLIC)

**Request:** Same as 4.2 but `ResultCode: 1001`

**Expected Response:**
```json
{
  "status": "ok"
}
```

**Database State After:**
- ✅ Sale status: 'failed'
- ✅ Sale payment_status: 'failed'
- ✅ callback_processed: true
- ✅ Token REFUNDED to wallet (balance restored)
- ✅ Stock NOT deducted
- ✅ Payment record status: 'failed'

**Validation:**
- ✅ Token refund works correctly
- ✅ Wallet balance increased by 1
- ✅ Stock remains unchanged
- ✅ No partial state

---

### Test Case 4.4: Idempotent Callback Handling
**Endpoint:** `POST /api/sales/mpesa/callback` (PUBLIC)

**Setup:** Sale 101 already processed (callback_processed: true)

**Request:** Same callback as 4.2

**Expected Response:**
```json
{
  "status": "ok"
}
```

**Database State:**
- ✅ Sale status: UNCHANGED
- ✅ Stock deduction: NOT repeated
- ✅ Token charge: NOT repeated
- ✅ Logged as "Callback already processed"

**Validation:**
- ✅ Duplicate callbacks don't cause duplicate stock deductions
- ✅ Idempotency working correctly

---

## Test Scenario 5: Error Cases (Critical!)

### Test Case 5.1: M-Pesa Payment Without Payment Config
**Endpoint:** `POST /api/sales/{id}/pay/mpesa`

**Setup:** Sale exists, but business has NO payment_config

**Request:**
```json
{
  "phone": "254712345678"
}
```

**Expected Response:**
```json
{
  "error": "Payment configuration not found",
  "hint": "Please setup your M-Pesa payment method",
  "setupUrl": "/api/payment-config/setup"
}
```

**Status Code:** 400

**Validation:**
- ✅ Error returned immediately
- ✅ STK push NOT attempted
- ✅ No Safaricom API call made
- ✅ Clear guidance to user

---

### Test Case 5.2: M-Pesa Payment With Inactive Config
**Endpoint:** `POST /api/sales/{id}/pay/mpesa`

**Setup:** Sale exists, payment_config exists but `is_active: false`

**Expected Response:**
```json
{
  "error": "Payment configuration is inactive",
  "hint": "Please enable your M-Pesa configuration in settings"
}
```

**Status Code:** 400

**Validation:**
- ✅ Inactive configs rejected
- ✅ Business can temporarily disable payment method

---

### Test Case 5.3: M-Pesa Payment With Invalid Config
**Endpoint:** `POST /api/sales/{id}/pay/mpesa`

**Setup:** Payment_config exists but credentials are INVALID

**Expected Response:**
```json
{
  "error": "Failed to initiate payment",
  "message": "M-Pesa error: 20 - Invalid credentials"
}
```

**Status Code:** 500

**Validation:**
- ✅ M-Pesa API error handled
- ✅ User informed of failure
- ✅ Sale not marked completed

---

## Test Scenario 6: The BROKEN `/api/payme` Flow

### Test Case 6.1: Using /api/payme with M-Pesa (BROKEN ❌)
**Endpoint:** `POST /api/payme`

**Request:**
```json
{
  "business_id": 1,
  "items": [
    {
      "product_id": 1,
      "quantity": 2
    }
  ],
  "payment_mode": "mpesa",
  "customer_phone": "254712345678"
}
```

**Current Broken Response:**
```json
{
  "message": "Sale created, awaiting MPESA payment",
  "sale": {...},
  "items": [...],
  "mpesa": {
    "status": "pending",
    "customer_phone": "254712345678",
    "amount": 200,
    "business_payment_method": "till_number",
    "business_payment_identifier": "600980",
    "note": "STK Push will be triggered with Safaricom Daraja API"
  }
}
```

**What Should Happen:**
```
Frontend expects:
- checkoutRequestId to be returned ← NOT returned!
- STK push to appear on phone ← NEVER HAPPENS!
- Sale status to update when paid ← STUCK IN PENDING!
```

**Actual Behavior:**
- ❌ Sale created but payment NEVER triggered
- ❌ No STK push to customer
- ❌ Sale sits in 'pending' forever
- ❌ Money never collected
- ❌ Stock deducted immediately (risky)
- ❌ Misleading response message

**Validation:**
- ✅ This is the broken endpoint identified in analysis
- ✅ MUST be either deleted or fixed
- ✅ Currently unusable for M-Pesa payments

---

## Test Scenario 7: Stock & Profit Accuracy

### Test Case 7.1: FIFO Stock Deduction
**Setup:**
- Product A has 3 batches:
  - Batch 1: 10 units @ 50 KSH (oldest)
  - Batch 2: 8 units @ 55 KSH
  - Batch 3: 5 units @ 60 KSH
- Total stock: 23 units

**Sale:** 15 units at 100 KSH each = 1500 total

**Expected Deduction (FIFO):**
- Batch 1: 10 units @ 50 KSH → profit 10*50 = 500
- Batch 2: 5 units @ 55 KSH → profit 5*45 = 225
- Total deduction: 15 units
- Total cost: 10*50 + 5*55 = 775
- Total profit: 1500 - 775 = 725

**Expected Stock Remaining:**
- Batch 1: 0 units
- Batch 2: 3 units @ 55 KSH
- Batch 3: 5 units @ 60 KSH
- Total: 8 units

**Validation:**
- ✅ Batches deducted in FIFO order
- ✅ Profit calculated correctly
- ✅ Stock movements logged per batch
- ✅ Unit costs preserved from FIFO

---

## Test Checklist (Before Production)

**Payment Config Setup:**
- [ ] Can create till config
- [ ] Can create paybill config
- [ ] Prevents duplicate config
- [ ] Can update config
- [ ] Can toggle active/inactive
- [ ] Can verify config (new endpoint)

**Sale Creation:**
- [ ] Creates sale with correct totals
- [ ] Validates stock availability
- [ ] Prevents overselling
- [ ] Reserves token correctly
- [ ] Sets correct profit
- [ ] Accepts cash or mpesa mode

**Cash Payment:**
- [ ] Completes sale immediately
- [ ] Deducts stock correctly
- [ ] Uses FIFO for costs
- [ ] Creates payment record
- [ ] Charges token

**M-Pesa Payment (Via `/api/sales`):**
- [ ] Checks payment config exists
- [ ] Checks config is active
- [ ] Initiates STK push
- [ ] Returns checkoutRequestId
- [ ] Callback updates sale
- [ ] Success marks completed
- [ ] Success deducts stock
- [ ] Success charges token
- [ ] Failure refunds token
- [ ] Callback idempotency works

**Error Handling:**
- [ ] No config → 400 error
- [ ] Inactive config → 400 error
- [ ] Invalid phone → 400 error
- [ ] Stock unavailable → 400 error
- [ ] Insufficient tokens → 402 error
- [ ] M-Pesa API failure → helpful error

**Data Integrity:**
- [ ] Stock counts accurate
- [ ] Profit calculations correct
- [ ] Token balances accurate
- [ ] No partial transactions
- [ ] All movements logged
- [ ] Audit trail complete

---

## Manual Testing Steps

### End-to-End Test: Complete M-Pesa Sale

```
1. Signup and create business
2. Add products to inventory
3. Setup payment config (till or paybill)
4. Verify payment config (new endpoint)
5. Create sale with 3 items
6. Initiate M-Pesa payment
7. Check sale status: stk_request_id set
8. Simulate M-Pesa callback (success)
9. Check sale status: completed
10. Check stock deduction: correct quantities
11. Check profit: correct based on FIFO
12. Check wallet: token charged
13. Check payment record: success
14. Check stock movements: logged per batch

Expected Result: ✅ All checks pass
```

---

## Production Validation Checklist

Before deploying M-Pesa to production:

- [ ] All test scenarios pass
- [ ] No console errors
- [ ] No database inconsistencies
- [ ] Logs show expected flow
- [ ] Load tested with 100+ concurrent requests
- [ ] Callback retry logic working
- [ ] Error messages are helpful
- [ ] Documentation updated
- [ ] Team trained
- [ ] Monitoring configured
- [ ] Rollback plan ready
