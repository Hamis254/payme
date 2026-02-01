# PayMe M-Pesa Payment Flows - Visual Comparison

## FLOW 1: ❌ INCOMPLETE - `/api/payme` Endpoint

```
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND: User selects items and payment method                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/payme                                                  │
│ Body: {                                                          │
│   business_id,                                                   │
│   items: [{product_id, quantity}],                             │
│   payment_mode: 'mpesa' | 'cash',                              │
│   customer_phone,                                                │
│   ...                                                            │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ payme.controller.js - processPayMe()                            │
│                                                                  │
│ ✅ Validates cart                                               │
│ ✅ Calculates totals                                            │
│ ✅ Creates sale (status: 'pending')                             │
│ ✅ Deducts stock                                                │
│ ✅ Calculates profit                                            │
│                                                                  │
│ ❌ DOES NOT check payment_configs table                         │
│ ❌ DOES NOT initiate STK Push                                   │
│ ❌ Returns sale with no payment trigger                         │
│                                                                  │
│ Response: {                                                      │
│   sale: {id, status: 'pending', ...},                          │
│   items: [...],                                                 │
│   mpesa: {                                                       │
│     status: 'pending',                                          │
│     customer_phone,                                              │
│     amount,                                                      │
│     business_payment_method: WRONG DATA ❌,                     │
│     note: 'STK Push will be triggered...' ← MISLEADING ❌       │
│   }                                                              │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND: Waiting for M-Pesa prompt                            │
│                                                                  │
│ ❌ NO STK PUSH SENT TO CUSTOMER                                 │
│ ❌ Sale stuck in pending state                                  │
│ ❌ Customer never prompted to pay                               │
│                                                                  │
│ Result: PAYMENT NEVER COMPLETED                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## FLOW 2: ✅ COMPLETE - `/api/sales` Endpoints (Recommended)

### Phase 1: Create Sale

```
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND: User adds items to cart                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/sales                                                  │
│ Body: {                                                          │
│   businessId,                                                    │
│   items: [{product_id, quantity, unit_price, unit_cost}],     │
│   paymentMode: 'cash' | 'mpesa',                               │
│   customerName?,                                                 │
│   ...                                                            │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ sales.controller.js - createSaleHandler()                       │
│                                                                  │
│ ✅ Validates stock availability                                 │
│ ✅ Calculates totals & profit (FIFO)                           │
│ ✅ Reserves 1 token from wallet (prepay)                       │
│ ✅ Creates sale (status: 'pending')                             │
│ ✅ Inserts sale items                                           │
│ ✅ Revenue Guard: Deducts tokens                                │
│                                                                  │
│ Response: {                                                      │
│   message: 'Sale created successfully',                         │
│   saleId: 123,                                                  │
│   totalAmount: 1500,                                            │
│   tokenFee: 1,                                                  │
│   ...                                                            │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                     [If payment_mode: 'cash']
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
          [Pay Cash]              [Pay M-Pesa]
            (Flow A)                (Flow B)
```

### Phase 2A: Cash Payment

```
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/sales/{saleId}/pay/cash                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ sales.controller.js - payCashHandler()                          │
│                                                                  │
│ ✅ Verifies sale ownership                                      │
│ ✅ Deducts stock using FIFO                                     │
│ ✅ Logs stock movements                                         │
│ ✅ Marks sale: status='completed'                               │
│ ✅ Charges token from wallet                                    │
│ ✅ Creates payment record                                       │
│                                                                  │
│ Response: {                                                      │
│   message: 'Payment completed successfully',                    │
│   saleId: 123                                                   │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ ✅ SALE COMPLETED                                               │
│ Stock deducted, Tokens charged, Money in hand                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2B: M-Pesa Payment - THE CRITICAL FLOW

```
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/sales/{saleId}/pay/mpesa                              │
│ Body: {                                                          │
│   phone: '+254712345678',                                       │
│   description?: 'Invoice details'                               │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ sales.controller.js - payMpesaHandler()                         │
│                                                                  │
│ ✅ Validates sale ownership & status                            │
│ ✅ Gets payment_configs for business                            │
│ ✅ CHECKS if config exists                                      │
│ ✅ CHECKS if config is active                                   │
│                                                                  │
│ If no config or inactive:                                       │
│   ❌ Returns 400 error                                          │
│   ❌ Instructs user to setup payment method                     │
│                                                                  │
│ If config valid:                                                │
│   ✅ Calls initiateBusinessPayment()                            │
│                                                                  │
│ Response: {                                                      │
│   message: 'M-Pesa payment initiated',                          │
│   saleId: 123,                                                  │
│   checkoutRequestId: 'ws_CO_DMZ_123456789',  ← STK ID           │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ mpesa.js - initiateBusinessPayment()                            │
│                                                                  │
│ ✅ Gets M-Pesa access token from Daraja                         │
│ ✅ Builds password: Base64(shortcode + passkey + timestamp)    │
│ ✅ Constructs STK Push payload:                                 │
│   - BusinessShortCode: from payment_configs.shortcode           │
│   - Amount: from sale.total_amount                              │
│   - PartyA: phone number                                        │
│   - AccountReference: from payment_configs.account_reference    │
│   - CallbackURL: MPESA_CALLBACK_URL                             │
│                                                                  │
│ ✅ POSTs to Safaricom Daraja API                                │
│   https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
│                                                                  │
│ Response from Daraja:                                           │
│   - ResponseCode: '0' (success)                                 │
│   - CheckoutRequestID: 'ws_CO_DMZ_...'                         │
│   - CustomerMessage: 'Enter MPESA PIN on your phone to complete'
│                                                                  │
│ ✅ Stores CheckoutRequestID in payments table                   │
│ ✅ Updates sale: stk_request_id, payment_status='initiated'    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CUSTOMER PHONE                                                   │
│                                                                  │
│ ✅ STK PUSH APPEARS ON SCREEN                                   │
│ ✅ Shows: "Enter MPESA PIN to complete payment of KSH 1500"    │
│ ✅ Customer enters PIN                                          │
│ ✅ Safaricom processes transaction                              │
│ ✅ Money deducted from customer account                         │
│ ✅ Safaricom sends callback to PayMe backend                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ POST /api/sales/mpesa/callback (PUBLIC - No Auth)               │
│ From: Safaricom M-Pesa (Daraja)                                 │
│                                                                  │
│ Callback Payload:                                                │
│ {                                                                │
│   Body: {                                                        │
│     stkCallback: {                                               │
│       CheckoutRequestID: 'ws_CO_DMZ_...',                       │
│       ResultCode: 0,   ← 0=success, non-0=failure              │
│       CallbackMetadata: {                                        │
│         Item: [                                                  │
│           {Name: 'Amount', Value: 1500},                        │
│           {Name: 'MpesaReceiptNumber', Value: 'ABC123XYZ'},    │
│           {Name: 'PhoneNumber', Value: '254712345678'},        │
│           {Name: 'TransactionDate', Value: '20260201120530'}   │
│         ]                                                        │
│       }                                                          │
│     }                                                            │
│   }                                                              │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ sales.controller.js - mpesaCallbackHandler()                    │
│                                                                  │
│ Runs in database TRANSACTION for atomicity                      │
│                                                                  │
│ If ResultCode === 0 (SUCCESS):                                  │
│   ✅ Gets sale by stk_request_id                                │
│   ✅ Checks idempotency (already processed?)                    │
│   ✅ Extracts callback metadata:                                │
│      - Amount, Receipt #, Phone, Transaction Date              │
│   ✅ Deducts stock using FIFO for each item                     │
│   ✅ Logs each stock movement                                   │
│   ✅ Updates sale: status='completed', payment_status='success' │
│   ✅ Stores M-Pesa receipt # and sender phone                   │
│   ✅ CHARGES token from wallet (token_fee deduction)            │
│   ✅ Updates wallet balance                                     │
│   ✅ Creates payment record with status='success'               │
│                                                                  │
│ If ResultCode !== 0 (FAILURE):                                  │
│   ✅ Marks sale: status='failed', payment_status='failed'       │
│   ✅ REFUNDS reserved token to wallet                           │
│   ✅ Updates wallet balance                                     │
│                                                                  │
│ ✅ Returns 200 OK to Safaricom (receipt acknowledged)           │
│                                                                  │
│ Response: {status: 'ok'}                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ DATABASE STATE - SUCCESS                                         │
│                                                                  │
│ sales table:                                                     │
│   ✅ status = 'completed'                                       │
│   ✅ payment_status = 'success'                                 │
│   ✅ mpesa_transaction_id = 'ABC123XYZ'                         │
│   ✅ mpesa_sender_phone = '254712345678'                        │
│   ✅ amount_paid = '1500'                                       │
│   ✅ callback_processed = true                                  │
│                                                                  │
│ stock_movements table:                                           │
│   ✅ type = 'sale'                                              │
│   ✅ quantity_change = '-10' (for each batch deducted)         │
│   ✅ unit_cost = '50' (from FIFO batch)                         │
│   ✅ reference_id = sale.id                                     │
│   ✅ reason = 'M-Pesa sale #123'                                │
│                                                                  │
│ wallets table:                                                   │
│   ✅ balance_tokens -= 1 (token charged)                        │
│                                                                  │
│ wallet_transactions table:                                       │
│   ✅ type = 'charge'                                            │
│   ✅ change_tokens = -1                                         │
│   ✅ note = 'Sale completed - M-Pesa ABC123XYZ'                 │
│                                                                  │
│ payments table:                                                  │
│   ✅ sale_id = 123                                              │
│   ✅ stk_request_id = 'ws_CO_DMZ_...'                           │
│   ✅ status = 'success'                                         │
│   ✅ amount = '1500'                                            │
│   ✅ phone = '254712345678'                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ ✅ PAYMENT COMPLETE & VERIFIED                                  │
│                                                                  │
│ ✅ Stock deducted correctly (FIFO cost tracking)               │
│ ✅ Customer charged the correct amount                         │
│ ✅ Business wallet credited                                    │
│ ✅ Tokens charged for the transaction                          │
│ ✅ Full audit trail in stock_movements                         │
│                                                                  │
│ Result: TRANSACTION ATOMIC & SUCCESSFUL                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Side-by-Side Comparison

| Aspect | `/api/payme` ❌ | `/api/sales` ✅ |
|--------|---|---|
| **Stock Availability Check** | ✅ Yes | ✅ Yes |
| **Stock Deduction** | ✅ Immediate | ⚠️ After payment |
| **Payment Config Check** | ❌ No | ✅ Yes |
| **Payment Config Enforcement** | ❌ No | ✅ Yes |
| **STK Push Triggered** | ❌ No | ✅ Yes |
| **Token Reservation** | ❌ No | ✅ Yes |
| **FIFO Cost Tracking** | ✅ Yes | ✅ Yes |
| **Callback Handling** | N/A | ✅ Atomic transaction |
| **Idempotency** | N/A | ✅ Prevents duplicates |
| **Token Charging** | ❌ No | ✅ Yes (on completion) |
| **Fallback Behavior** | N/A | ⚠️ Risky fallback to wallet |
| **Error Handling** | ⚠️ Basic | ✅ Comprehensive |
| **Production Ready** | ❌ No | ✅ 90% (needs fallback fix) |

---

## Decision Tree for Frontend

```
┌─────────────────────────────────────────┐
│ User wants to make a sale               │
└─────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ Is payment method     │
        │ setup complete?       │
        └───────────────────────┘
             │              │
           YES             NO
             │              │
             │              ▼
             │      ┌──────────────────┐
             │      │ Redirect user to │
             │      │ payment setup    │
             │      │ /api/payment-    │
             │      │ config/setup     │
             │      └──────────────────┘
             │
             ▼
    ┌─────────────────────┐
    │ Create Sale         │
    │ POST /api/sales     │
    └─────────────────────┘
             │
             ▼
    ┌──────────────────────┐
    │ Payment method?      │
    └──────────────────────┘
         │             │
       CASH         M-PESA
         │             │
         ▼             ▼
    POST /api/     POST /api/
    sales/{id}/    sales/{id}/
    pay/cash       pay/mpesa
         │             │
         │             ▼
         │       ✅ STK PUSH
         │       APPEARS ON
         │       CUSTOMER PHONE
         │             │
         │             ▼
         │       Customer enters
         │       M-Pesa PIN
         │             │
         │             ▼
         │       Safaricom processes
         │       and sends callback
         │             │
         ┴─────────┬───┘
                   │
                   ▼
         ✅ TRANSACTION COMPLETE
         Stock deducted, tokens charged
```

---

## CRITICAL FINDING

**Using `/api/payme` with M-Pesa will NEVER trigger payment.** 

The endpoint exists but is incomplete. It reads misleading response data from the wrong database columns and doesn't actually call the M-Pesa API.

**Frontend MUST use `/api/sales` → `/api/sales/{id}/pay/mpesa` flow.**
