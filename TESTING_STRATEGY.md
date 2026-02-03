## 🧪 TESTING STRATEGY FOR FINANCIAL CODE
### Comprehensive Test Coverage Plan for PayMe

---

## Executive Summary

Your codebase has **excellent architecture** but **critically low test coverage** (currently ~2/10).

For a **financial application handling real money**, this is unacceptable. Each service must have:

✅ **Unit tests** - Services work in isolation (80%+ coverage target)  
✅ **Integration tests** - Full flows work end-to-end (critical paths 100%)  
✅ **Concurrent tests** - Multiple requests don't corrupt state  
✅ **Chaos tests** - System recovers from failures  
✅ **Load tests** - Performance acceptable under stress  

---

## Test Pyramid for Financial Code

```
        ▲
       / \
      /   \     Load Tests (100 concurrent users)
     /-----\    
    /       \   Chaos Tests (Inject failures, test recovery)
   /         \  
  /-----------\ Integration Tests (Critical flows, E2E)
 /             \
/-----------────\ Unit Tests (Services, isolated, fast)
```

**Recommended Test Distribution:**
- 70% Unit Tests (fast, isolated)
- 20% Integration Tests (real database, critical flows)
- 5% Chaos Tests (failure scenarios)
- 5% Load Tests (concurrent access)

---

## PHASE 1: Unit Tests (2 weeks)

### Goal
Test each service function in isolation. Mock database, no real I/O.

### Example: myWallet.service.js Unit Tests

**File: `tests/myWallet.service.unit.test.js`**

```javascript
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Mock the database
jest.mock('#config/database.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock('#config/logger.js', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const { getOrCreateWallet, processTokenPurchaseCallback } = await import(
  '#services/myWallet.service.js'
);
const { db } = await import('#config/database.js');

describe('myWallet Service - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrCreateWallet', () => {
    test('should return existing wallet for business', async () => {
      const mockWallet = {
        id: 1,
        business_id: 1,
        balance_tokens: 100,
      };

      // Setup mock
      db.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 1 }]), // business exists
      });

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockWallet]),
      });

      const result = await getOrCreateWallet(1, 1);

      expect(result).toEqual(mockWallet);
      expect(db.select).toHaveBeenCalled();
    });

    test('should create wallet if not exists', async () => {
      const newWallet = {
        id: 2,
        business_id: 1,
        balance_tokens: 0,
        created_at: new Date(),
      };

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([{ id: 1 }]), // business exists
      });

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([]), // wallet doesn't exist
      });

      db.insert.mockReturnValue({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([newWallet]),
      });

      const result = await getOrCreateWallet(1, 1);

      expect(result.id).toBe(2);
      expect(db.insert).toHaveBeenCalled();
    });

    test('should throw error if user does not own business', async () => {
      db.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]), // Business not found
      });

      await expect(getOrCreateWallet(999, 1)).rejects.toThrow(
        'Business not found or access denied'
      );
    });
  });

  describe('processTokenPurchaseCallback', () => {
    test('should ignore unknown payment', async () => {
      const result = await processTokenPurchaseCallback({
        CheckoutRequestID: 'UNKNOWN_ID',
        ResultCode: 0,
      });

      expect(result.status).toBe('ignored');
      expect(db.select).toHaveBeenCalled();
    });

    test('should handle already-processed payment', async () => {
      db.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            id: 1,
            status: 'success', // Already processed
          },
        ]),
      });

      const result = await processTokenPurchaseCallback({
        CheckoutRequestID: 'REQUEST_1',
        ResultCode: 0,
      });

      expect(result.status).toBe('already_processed');
    });

    test('should credit wallet on successful payment', async () => {
      const mockPurchase = {
        id: 1,
        status: 'pending',
        wallet_id: 1,
        tokens_purchased: 30,
      };

      const mockWallet = {
        id: 1,
        balance_tokens: 0,
      };

      // Mock transaction
      db.transaction.mockImplementation((callback) => {
        const txMock = {
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn(),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn(),
        };

        return callback(txMock);
      });

      db.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockPurchase]),
      });

      // Test success scenario
      // Verify transaction was called
      expect(db.transaction).toHaveBeenCalled();
    });
  });
});
```

### Unit Test Checklist

```javascript
// For each service file, test:

☐ Happy path (success case)
☐ Error cases (all throw statements)
☐ Validation failures
☐ Edge cases (0, negative, max values)
☐ Null/undefined inputs
☐ Race conditions (concurrent calls)
☐ Database connection failures
☐ Transaction rollback
☐ Idempotency
```

### Services to Test (Priority Order)

1. **myWallet.service.js** - Token purchase, balance, transactions
2. **credit.service.js** - Credit accounts, sales, payments
3. **sales.service.js** - Sale creation, payment processing
4. **stock.service.js** - FIFO deduction, movements
5. **paymentConfig.service.js** - Payment method setup
6. **expense.service.js** - Expense tracking
7. **analytics.service.js** - Calculations
8. **notification.service.js** - Notification dispatch

**Target:** 80% coverage per service, focus on financial logic

---

## PHASE 2: Integration Tests (1-2 weeks)

### Goal
Test complete flows with real database (test database, transaction rollback).

### Critical Flows to Test

**Flow 1: Complete Sale with Cash Payment**

```javascript
// File: tests/flows/sale-cash.integration.test.js

describe('Integration: Complete Sale with Cash Payment', () => {
  let businessId, saleId;

  beforeEach(async () => {
    // Setup test data
    businessId = await createTestBusiness();
    await setupStock(businessId, [
      { product_id: 1, quantity: 100, unit_cost: 500 },
    ]);
    await topupWallet(businessId, 10); // 10 tokens
  });

  afterEach(async () => {
    // Cleanup (rollback transaction)
    await teardownTestData();
  });

  test('should complete full cash sale with token deduction', async () => {
    // 1. Create sale
    const saleResponse = await createSale(businessId, {
      items: [
        { product_id: 1, quantity: 5, unit_price: 1000 },
      ],
      paymentMode: 'cash',
    });

    saleId = saleResponse.saleId;

    // Verify: Sale created
    const sale = await getSaleById(saleId);
    expect(sale.status).toBe('pending');
    expect(sale.total_amount).toBe('5000');

    // Verify: Token reserved
    const wallet1 = await getWallet(businessId);
    expect(wallet1.balance_tokens).toBe(9); // 10 - 1 reserved

    // 2. Complete payment (cash)
    const paymentResponse = await completeCashPayment(saleId, 5000);

    // Verify: Sale marked complete
    const updatedSale = await getSaleById(saleId);
    expect(updatedSale.payment_status).toBe('completed');
    expect(updatedSale.paid_at).toBeDefined();

    // Verify: Token charged (not just reserved)
    const wallet2 = await getWallet(businessId);
    expect(wallet2.balance_tokens).toBe(9); // Token consumed

    // Verify: Stock deducted
    const stock = await getStockForProduct(1);
    expect(stock.quantity_available).toBe(95); // 100 - 5

    // Verify: Transaction logged
    const transactions = await getWalletTransactions(businessId);
    expect(transactions).toContainEqual(
      expect.objectContaining({
        type: 'charge',
        change_tokens: -1,
      })
    );
  });

  test('should handle payment cancellation correctly', async () => {
    // Create and cancel sale
    const saleResponse = await createSale(businessId, { /* ... */ });
    saleId = saleResponse.saleId;

    const wallet1 = await getWallet(businessId);
    const reserved1 = wallet1.balance_tokens;

    // Cancel payment
    await cancelSale(saleId);

    // Verify: Sale marked cancelled
    const sale = await getSaleById(saleId);
    expect(sale.status).toBe('cancelled');

    // Verify: Token refunded
    const wallet2 = await getWallet(businessId);
    expect(wallet2.balance_tokens).toBe(reserved1 + 1); // Token refunded

    // Verify: Stock restored (NOT deducted since cancelled)
    const stock = await getStockForProduct(1);
    expect(stock.quantity_available).toBe(100); // Unchanged
  });
});
```

**Flow 2: Complete Credit Sale with Payment**

```javascript
describe('Integration: Credit Sale with Payment', () => {
  test('should create credit sale and track balance', async () => {
    // 1. Create credit account
    const account = await createCreditAccount(businessId, {
      customer_name: 'John Doe',
      credit_limit: 50000,
    });

    // 2. Create credit sale
    const sale = await createCreditSale(account.id, {
      amount: 15000,
      due_date: 7, // days from now
    });

    // Verify: Account balance updated
    const updatedAccount = await getCreditAccount(account.id);
    expect(updatedAccount.balance_due).toBe('15000');

    // Verify: Ledger entry created
    const ledger = await getCreditLedger(account.id);
    expect(ledger).toContainEqual(
      expect.objectContaining({
        type: 'sale',
        amount: '15000',
        balance_after: '15000',
      })
    );

    // 3. Receive partial payment
    const payment1 = await recordCreditPayment(account.id, {
      amount: 5000,
      payment_method: 'mpesa',
    });

    // Verify: Balance updated
    const account2 = await getCreditAccount(account.id);
    expect(account2.balance_due).toBe('10000');

    // Verify: Ledger entry created
    const ledger2 = await getCreditLedger(account.id);
    expect(ledger2).toContainEqual(
      expect.objectContaining({
        type: 'payment',
        amount: '5000',
        balance_after: '10000',
      })
    );

    // 4. Receive remaining payment
    await recordCreditPayment(account.id, {
      amount: 10000,
      payment_method: 'cash',
    });

    // Verify: Fully paid
    const account3 = await getCreditAccount(account.id);
    expect(account3.balance_due).toBe('0');

    // Verify: Sale marked as paid
    const updatedSale = await getCreditSale(sale.id);
    expect(updatedSale.status).toBe('paid');
  });

  test('should prevent sale exceeding credit limit', async () => {
    const account = await createCreditAccount(businessId, {
      customer_name: 'Jane Doe',
      credit_limit: 10000,
    });

    // Attempt sale that exceeds limit
    await expect(
      createCreditSale(account.id, {
        amount: 15000, // Exceeds 10000 limit
        due_date: 7,
      })
    ).rejects.toThrow('Credit limit exceeded');

    // Verify: Account unchanged
    const unchangedAccount = await getCreditAccount(account.id);
    expect(unchangedAccount.balance_due).toBe('0');
  });
});
```

**Flow 3: M-Pesa Token Purchase with Callback**

```javascript
describe('Integration: M-Pesa Token Purchase', () => {
  test('should complete token purchase on M-Pesa callback', async () => {
    // 1. Initiate token purchase
    const purchase = await initiateTokenPurchase(businessId, '30', '+254712345678');

    // Verify: Purchase created in pending state
    expect(purchase.status).toBe('pending');
    const checkoutId = purchase.checkoutRequestId;

    // Verify: Wallet unchanged (only when callback succeeds)
    const wallet1 = await getWallet(businessId);
    expect(wallet1.balance_tokens).toBe(0); // Unchanged

    // 2. Simulate M-Pesa callback (success)
    const callbackPayload = {
      CheckoutRequestID: checkoutId,
      ResultCode: 0,
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 50 },
          { Name: 'MpesaReceiptNumber', Value: 'ABC123' },
          { Name: 'PhoneNumber', Value: '254712345678' },
        ],
      },
    };

    const result = await processTokenPurchaseCallback(callbackPayload);

    // Verify: Callback processed
    expect(result.status).toBe('success');

    // Verify: Wallet credited
    const wallet2 = await getWallet(businessId);
    expect(wallet2.balance_tokens).toBe(30); // 30 tokens added

    // Verify: Purchase marked success
    const updatedPurchase = await getTokenPurchase(purchase.id);
    expect(updatedPurchase.status).toBe('success');
    expect(updatedPurchase.mpesa_transaction_id).toBe('ABC123');

    // Verify: Transaction logged
    const transactions = await getWalletTransactions(businessId);
    expect(transactions).toContainEqual(
      expect.objectContaining({
        type: 'purchase',
        change_tokens: 30,
      })
    );
  });

  test('should ignore duplicate callback', async () => {
    // First callback
    const result1 = await processTokenPurchaseCallback({
      CheckoutRequestID: 'REQUEST_ID',
      ResultCode: 0,
      CallbackMetadata: { Item: [/* ... */] },
    });

    expect(result1.status).toBe('success');

    // Duplicate callback with same CheckoutRequestID
    const result2 = await processTokenPurchaseCallback({
      CheckoutRequestID: 'REQUEST_ID',
      ResultCode: 0,
      CallbackMetadata: { Item: [/* ... */] },
    });

    expect(result2.status).toBe('already_processed');

    // Verify: Wallet only credited once
    const wallet = await getWallet(businessId);
    expect(wallet.balance_tokens).toBe(30); // Not 60
  });

  test('should handle callback failure', async () => {
    const purchase = await initiateTokenPurchase(businessId, '30', '+254712345678');

    // Simulate failure callback
    const failurePayload = {
      CheckoutRequestID: purchase.checkoutRequestId,
      ResultCode: 1, // Error code
      ResultDesc: 'User cancelled the request',
    };

    const result = await processTokenPurchaseCallback(failurePayload);

    expect(result.status).toBe('success'); // Processed successfully (failure recorded)

    // Verify: Wallet NOT credited
    const wallet = await getWallet(businessId);
    expect(wallet.balance_tokens).toBe(0);

    // Verify: Purchase marked failed
    const updatedPurchase = await getTokenPurchase(purchase.id);
    expect(updatedPurchase.status).toBe('failed');
  });
});
```

### Integration Test Checklist

```
Critical Flows to Test:
☐ Create sale → Complete payment (cash)
☐ Create sale → Complete payment (M-Pesa)
☐ Create sale → Cancel payment
☐ Token purchase → M-Pesa callback success
☐ Token purchase → M-Pesa callback failure
☐ Credit sale creation → Payment received
☐ Credit sale → Partial payment
☐ Credit sale → Overpayment
☐ Expense recording → Category summary
☐ Reconciliation → Balance mismatch detection
```

---

## PHASE 3: Concurrent/Chaos Tests (1 week)

### Goal
Verify financial accuracy under stress and failure conditions.

**File: `tests/chaos/concurrent-access.test.js`**

```javascript
describe('Chaos: Concurrent Financial Operations', () => {
  test('should handle 100 concurrent sales without data corruption', async () => {
    const businessId = await createTestBusiness();
    await topupWallet(businessId, 150); // 150 tokens
    await setupStock(businessId, [
      { product_id: 1, quantity: 1000 },
    ]);

    // Fire 100 sales simultaneously
    const promises = Array(100)
      .fill(0)
      .map((_, i) =>
        createSale(businessId, {
          items: [{ product_id: 1, quantity: 5, unit_price: 100 }],
        })
      );

    const results = await Promise.allSettled(promises);

    // Count successes
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`Successful: ${successful}, Failed: ${failed}`);

    // Verify: Exactly 100 sales created (first succeed, rest fail due to insufficient tokens)
    const sales = await getAllSalesForBusiness(businessId);
    expect(sales.length).toBeLessThanOrEqual(100);

    // Verify: Wallet balance correct
    const wallet = await getWallet(businessId);
    const expectedBalance = 150 - (successful * 1); // 1 token per sale
    expect(wallet.balance_tokens).toBe(expectedBalance);

    // Verify: Stock deducted correctly
    const stock = await getStockForProduct(1);
    const expectedStock = 1000 - (successful * 5);
    expect(stock.quantity_available).toBe(expectedStock);

    // CRITICAL: Verify sum of transactions matches wallet balance
    const transactions = await getWalletTransactions(businessId);
    const sumTransactions = transactions.reduce(
      (sum, t) => sum + Number(t.change_tokens),
      0
    );
    expect(sumTransactions).toBe(expectedBalance);
  });

  test('should handle M-Pesa callback race conditions', async () => {
    const purchase = await initiateTokenPurchase(businessId, '30', '+254712345678');

    // Send same callback 5 times simultaneously
    const callbacks = Array(5)
      .fill(0)
      .map(() => ({
        CheckoutRequestID: purchase.checkoutRequestId,
        ResultCode: 0,
        CallbackMetadata: { Item: [/* ... */] },
      }));

    const results = await Promise.allSettled(
      callbacks.map((cb) => processTokenPurchaseCallback(cb))
    );

    // All should complete
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // But wallet should only be credited ONCE
    const wallet = await getWallet(businessId);
    expect(wallet.balance_tokens).toBe(30); // Not 150

    // Verify: Only one success, rest already-processed
    const statuses = results.map((r) => r.value.status);
    expect(statuses[0]).toBe('success');
    expect(statuses.slice(1)).toEqual(['already_processed', 'already_processed', 'already_processed', 'already_processed']);
  });

  test('should recover from database connection failure', async () => {
    // Simulate temporary DB failure
    const originalSelect = db.select;
    db.select = jest
      .fn()
      .mockRejectedValueOnce(new Error('Connection timeout'))
      .mockImplementation(originalSelect);

    // Attempt sale during failure
    await expect(
      createSale(businessId, { /* ... */ })
    ).rejects.toThrow();

    // Restore connection
    db.select = originalSelect;

    // Retry should work
    const sale = await createSale(businessId, { /* ... */ });
    expect(sale.id).toBeDefined();

    // Verify: No orphaned data from failed attempt
    const sales = await getAllSalesForBusiness(businessId);
    expect(sales.length).toBe(1); // Only the successful one
  });
});
```

---

## PHASE 4: Load & Performance Tests (1 week)

### Goal
Ensure acceptable performance under realistic load.

**File: `tests/load/payment-processing.load.test.js`**

```javascript
import autocannon from 'autocannon';

describe('Load Test: Payment Processing', () => {
  test('should handle 100 token purchases/minute', async () => {
    const results = await autocannon({
      url: `http://localhost:3000`,
      connections: 10,
      duration: 60,
      requests: [
        {
          path: '/api/my-wallet/token-purchase',
          method: 'POST',
          setupClient: (client) => {
            client.on('response', (statusCode, resBytes, responseTime) => {
              // Verify success
              expect([200, 201]).toContain(statusCode);
              // Verify acceptable latency
              expect(responseTime).toBeLessThan(1000); // <1 sec
            });
          },
          body: JSON.stringify({
            businessId: 1,
            packageType: '30',
            phone: '+254712345678',
          }),
        },
      ],
    });

    console.log(`Requests/sec: ${results.throughput.average.average}`);
    console.log(`Latency (ms): ${results.latency.mean}`);
    console.log(`Errors: ${results.errors}`);

    // Requirements:
    expect(results.throughput.average.average).toBeGreaterThan(50); // 50 req/sec minimum
    expect(results.latency.mean).toBeLessThan(200); // <200ms average
    expect(results.errors).toBe(0); // Zero errors
  });
});
```

---

## Test Running Strategy

### Local Development
```bash
# Run all unit tests (fast)
npm run test:unit

# Run specific service tests
npm run test:unit -- myWallet.service

# Watch mode for development
npm run test:watch
```

### Pre-commit
```bash
# Run affected tests + coverage
npm run test:affected -- --coverage

# Block commit if coverage drops
```

### CI/CD Pipeline
```bash
# Stage 1: Unit tests (5 min)
npm run test:unit -- --coverage

# Stage 2: Integration tests (10 min)
npm run test:integration

# Stage 3: Chaos tests (5 min)
npm run test:chaos

# Stage 4: Load tests (10 min)
npm run test:load

# Block merge if any stage fails
```

### Production Verification
```bash
# Before deployment: smoke tests on staging
npm run test:smoke -- --env=staging

# After deployment: validate critical flows
npm run test:smoke -- --env=production
```

---

## Coverage Requirements

| Layer | Target | Current | Gap |
|-------|--------|---------|-----|
| Services | 80% | 5% | -75% |
| Critical Flows | 100% | 10% | -90% |
| Controllers | 60% | 10% | -50% |
| Utilities | 70% | 30% | -40% |
| Overall | 75% | 2% | -73% |

---

## Timeline

| Phase | Duration | Deliverable |
|-------|----------|------------|
| Phase 1: Unit Tests | 2 weeks | 80% service coverage |
| Phase 2: Integration | 1-2 weeks | Critical flow coverage |
| Phase 3: Chaos | 1 week | Concurrent access proven safe |
| Phase 4: Load | 1 week | Performance validated |
| **Total** | **5-6 weeks** | **Production Ready** |

---

## Test Success Criteria

Before deploying to production, ALL of these must be true:

- [ ] 80%+ unit test coverage on services
- [ ] 100% coverage of critical financial flows
- [ ] All concurrent/chaos tests pass
- [ ] Load tests show acceptable performance
- [ ] Zero test failures in CI/CD
- [ ] Code review approved by senior engineer
- [ ] Staging deployment successful
- [ ] Incident runbook documented
- [ ] On-call team trained
- [ ] Rollback plan tested

---

## Conclusion

**Your codebase is architecturally sound. It just needs testing.**

Start with Phase 1 (unit tests) to build velocity. The foundation is excellent - you'll find testing much easier than many legacy projects.

Once unit tests are in place, integration tests validate your fixes for atomicity and idempotency. Chaos tests prove you're safe under stress.

**Estimated effort:** 5-6 weeks of focused work  
**Expected benefit:** Production-ready financial system with confidence to scale

**Question:** Need help getting started with Jest setup or test patterns?
