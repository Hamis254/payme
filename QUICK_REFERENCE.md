## ⚡ QUICK REFERENCE: Critical Issues & Fixes
### For Developers Implementing Changes

---

## The 8 Critical Issues (Priority Order)

### 🔴 ISSUE #1: Transaction Atomicity in Sales (CRITICAL)
**Problem:** Stock availability checked BEFORE transaction → race condition possible

**File:** `src/controllers/sales.controller.js` lines ~85-150  
**Impact:** Stock overselling, inventory corruption  
**Likelihood:** Medium (happens under concurrent load)

**The Fix:**
```javascript
// BEFORE (WRONG - race condition)
const available = await checkStock(items);  // Check outside transaction
if (!available) throw new Error('Insufficient stock');

await db.transaction(async tx => {
  await tx.insert(sales).values({...});      // Create sale
  await deductStockFIFO(items, tx);          // Deduct stock
  // If system crashes between these 2 lines, stock is lost
});

// AFTER (CORRECT - atomic)
await db.transaction(async tx => {
  // Check AND deduct in same transaction with row locks
  const stock = await tx.select().from(products)
    .where(eq(products.id, item.product_id))
    .for('update');  // Row-level lock prevents concurrent modification
  
  if (stock.quantity < item.quantity) {
    throw new Error('Insufficient stock');
  }
  
  // Now we're safe - no one else can modify this stock
  await tx.insert(sales).values({...});
  await deductStockFIFO(items, tx);
});
```

**Test This:**
```javascript
test('concurrent sales should not cause overselling', async () => {
  // Fire 100 sales simultaneously, each buying 10 units of 100 available
  // Only first 10 should succeed, rest should fail with "insufficient stock"
  // Verify: exactly 10 sales created, stock = 0, no corruption
});
```

**Estimated Time:** 8 hours (implementation + testing)

---

### 🔴 ISSUE #2: Idempotency for M-Pesa Callbacks (CRITICAL)
**Problem:** Same callback received twice → tokens credited twice

**File:** `src/services/myWallet.service.js` lines ~120-150  
**Impact:** Duplicate token credit, wallet manipulation  
**Likelihood:** HIGH (M-Pesa often retries failed callbacks)

**The Fix:**
```javascript
// BEFORE (WRONG - vulnerable to duplicates)
if (purchase.status === 'success' || purchase.status === 'failed') {
  return { status: 'already_processed' };  // Weak check
}

// AFTER (CORRECT - idempotency with unique constraint)
// 1. Add column to token_purchases table:
ALTER TABLE token_purchases ADD COLUMN IF NOT EXISTS mpesa_receipt_id VARCHAR(50) UNIQUE;

// 2. Check by receipt ID (M-Pesa guarantees unique per transaction)
const existing = await tx.select()
  .from(tokenPurchases)
  .where(eq(tokenPurchases.mpesa_receipt_id, mpesaReceiptId))
  .limit(1);

if (existing.length > 0) {
  return { status: 'already_processed', data: existing[0] };
}

// 3. Only process if first time seeing this receipt
const purchase = await tx.select()
  .from(tokenPurchases)
  .where(eq(tokenPurchases.checkoutRequestId, checkoutId))
  .limit(1);

if (purchase.status !== 'pending') {
  return { status: 'already_processed', data: purchase };
}

// 4. Now process with idempotency key stored
await tx.update(tokenPurchases)
  .set({
    status: 'success',
    mpesa_receipt_id: mpesaReceiptId,  // Unique constraint ensures once only
    mpesa_transaction_id: mpesaRefNumber,
  })
  .where(eq(tokenPurchases.id, purchase.id));

await tx.update(wallets)
  .set({
    balance_tokens: sql`balance_tokens + ${tokensToAdd}`,
  })
  .where(eq(wallets.id, purchase.wallet_id));
```

**Test This:**
```javascript
test('should ignore duplicate M-Pesa callback', async () => {
  const checkoutId = 'REQUEST_12345';
  const receipt = 'ABC123XYZ';
  
  // First callback
  await processCallback({
    CheckoutRequestID: checkoutId,
    CallbackMetadata: { Item: [
      { Name: 'MpesaReceiptNumber', Value: receipt },
      { Name: 'Amount', Value: 50 },
    ]},
  });
  
  // Second callback with same receipt
  await processCallback({
    CheckoutRequestID: checkoutId,
    CallbackMetadata: { Item: [
      { Name: 'MpesaReceiptNumber', Value: receipt },
      { Name: 'Amount', Value: 50 },
    ]},
  });
  
  // Verify: tokens credited only ONCE
  const wallet = await getWallet(businessId);
  expect(wallet.balance_tokens).toBe(30); // Not 60
  
  // Verify: only one transaction in ledger
  const transactions = await getWalletTransactions(businessId);
  const creditTxs = transactions.filter(t => t.type === 'purchase');
  expect(creditTxs.length).toBe(1);
});
```

**Estimated Time:** 12 hours (schema change, migration, testing)

---

### 🔴 ISSUE #3: Atomic Credit Sale + Ledger (CRITICAL)
**Problem:** Credit sale created but ledger not updated → balance inconsistency

**File:** `src/services/credit.service.js` - `createCreditSale()` function  
**Impact:** balance_due becomes inconsistent with actual ledger  
**Likelihood:** Medium (happens if system crashes mid-transaction)

**The Fix:**
```javascript
// BEFORE (WRONG - separate operations)
const sale = await db.insert(creditSales).values({...}).returning();
const ledger = await db.insert(creditLedger).values({...}).returning();

// AFTER (CORRECT - atomic transaction)
const [saleAndLedger] = await db.transaction(async tx => {
  // Create sale
  const [sale] = await tx.insert(creditSales).values({
    account_id: accountId,
    amount: amount,
    status: 'pending_payment',
    sale_date: new Date(),
  }).returning();

  // Update balance_due (incremental update)
  const [account] = await tx.update(creditAccounts)
    .set({
      balance_due: sql`balance_due + ${amount}`,
    })
    .where(eq(creditAccounts.id, accountId))
    .returning();

  // Create ledger entry
  const [ledger] = await tx.insert(creditLedger).values({
    account_id: accountId,
    sale_id: sale.id,
    type: 'sale',
    amount: amount,
    balance_after: account.balance_due,  // Use updated balance
    recorded_at: new Date(),
  }).returning();

  return { sale, ledger, account };
});

return saleAndLedger;
```

**Test This:**
```javascript
test('credit sale should atomically update account and ledger', async () => {
  const account = await createCreditAccount(businessId, {
    credit_limit: 100000,
  });
  
  expect(account.balance_due).toBe('0');
  
  // Create credit sale
  const sale = await createCreditSale(account.id, { amount: 15000 });
  
  // Verify: account balance updated
  const updated = await getCreditAccount(account.id);
  expect(updated.balance_due).toBe('15000');
  
  // Verify: ledger entry created
  const ledger = await getCreditLedger(account.id);
  expect(ledger).toContainEqual(
    expect.objectContaining({
      type: 'sale',
      amount: '15000',
      balance_after: '15000',
      sale_id: sale.id,
    })
  );
  
  // Verify: sum of transactions equals balance
  const sum = ledger.reduce((s, e) => {
    if (e.type === 'sale') return s + Number(e.amount);
    if (e.type === 'payment') return s - Number(e.amount);
    return s;
  }, 0);
  expect(sum).toBe(15000);
});
```

**Estimated Time:** 8 hours

---

### 🟡 ISSUE #4: Audit Logging (HIGH)
**Problem:** No immutable record of financial transactions → can't verify what happened

**File:** `src/services/` - all financial operations  
**Impact:** Can't dispute chargebacks, regulatory non-compliance  
**Likelihood:** HIGH (inevitable with real money)

**The Fix:**
```javascript
// 1. Create audit log function
async function auditFinancial(db, {
  user_id,
  business_id,
  action,  // 'PAYMENT_RECEIVED', 'TOKEN_PURCHASE', 'SALE_COMPLETED'
  entity_type,  // 'SALE', 'WALLET', 'CREDIT_PAYMENT'
  entity_id,
  amount,
  status,  // 'success', 'failed', 'pending'
  metadata = {},  // M-Pesa ref, phone, etc.
  ip_address,
}) {
  return await db.insert(auditLogs).values({
    user_id,
    business_id,
    action,
    entity_type,
    entity_id,
    amount: amount.toString(),
    status,
    metadata: JSON.stringify(metadata),
    created_at: new Date(),
    ip_address,
  });
}

// 2. Use in M-Pesa callback processing
await db.transaction(async tx => {
  // ... credit tokens ...
  
  await auditFinancial(tx, {
    user_id: business.user_id,
    business_id: business.id,
    action: 'TOKEN_PURCHASE_SUCCESS',
    entity_type: 'WALLET_TRANSACTION',
    entity_id: transaction.id,
    amount: tokensAdded,
    status: 'success',
    metadata: {
      mpesa_ref: mpesaRefNumber,
      phone: phone,
      source: 'M-PESA',
    },
    ip_address: req.ip,
  });
});

// 3. Use in sales
await db.transaction(async tx => {
  // ... create sale, deduct stock ...
  
  await auditFinancial(tx, {
    user_id: business.user_id,
    business_id: business.id,
    action: 'SALE_COMPLETED',
    entity_type: 'SALE',
    entity_id: sale.id,
    amount: totalAmount,
    status: 'completed',
    metadata: {
      items: saleItems.length,
      payment_method: paymentMode,
    },
    ip_address: req.ip,
  });
});
```

**Test This:**
```javascript
test('all financial transactions should be logged', async () => {
  // Create sale, process payment
  const sale = await createSale(businessId, {...});
  await completeCashPayment(sale.id, 5000);
  
  // Verify: audit log entries created
  const logs = await getAuditLogs(businessId);
  expect(logs).toContainEqual(
    expect.objectContaining({
      action: 'SALE_COMPLETED',
      entity_type: 'SALE',
      entity_id: sale.id,
      status: 'success',
    })
  );
});
```

**Estimated Time:** 16 hours

---

### 🟡 ISSUE #5: Error Recovery (HIGH)
**Problem:** Failed operations not retried → payments lost, customers frustrated

**File:** `src/services/myWallet.service.js`, `src/controllers/sales.controller.js`  
**Impact:** Customer lost payments, support tickets  
**Likelihood:** Medium (network failures happen)

**The Fix:**
```javascript
// 1. Add dead letter queue for failed operations
const queue = new PQueue({ concurrency: 5, interval: 1000, intervalCap: 10 });

async function queueFailedOperation(operation) {
  // Store in database for retry
  await db.insert(failedOperations).values({
    operation_type: operation.type,  // 'M-PESA_CALLBACK', 'STOCK_DEDUCTION'
    entity_id: operation.entity_id,
    payload: JSON.stringify(operation),
    attempt: 1,
    next_retry: new Date(Date.now() + 60 * 1000), // Retry in 1 min
    status: 'queued',
  });
}

// 2. Periodic retry worker
async function processFailedOperations() {
  const failed = await db.select()
    .from(failedOperations)
    .where(
      and(
        eq(failedOperations.status, 'queued'),
        lte(failedOperations.next_retry, new Date())
      )
    )
    .limit(100);

  for (const operation of failed) {
    try {
      // Attempt recovery
      if (operation.operation_type === 'M-PESA_CALLBACK') {
        await processTokenPurchaseCallback(JSON.parse(operation.payload));
      }
      
      // Mark success
      await db.update(failedOperations)
        .set({ status: 'success', completed_at: new Date() })
        .where(eq(failedOperations.id, operation.id));
    } catch (error) {
      // Exponential backoff
      const newAttempt = operation.attempt + 1;
      const backoffMs = Math.min(
        300000, // Max 5 minutes
        1000 * Math.pow(2, newAttempt)
      );
      
      if (newAttempt > 5) {
        // Give up after 5 retries
        await db.update(failedOperations)
          .set({ status: 'failed', error_message: error.message })
          .where(eq(failedOperations.id, operation.id));
        
        // Alert support team
        await notifyOncall('Failed operation: ' + operation.operation_type);
      } else {
        await db.update(failedOperations)
          .set({
            attempt: newAttempt,
            next_retry: new Date(Date.now() + backoffMs),
          })
          .where(eq(failedOperations.id, operation.id));
      }
    }
  }
}

// 3. Run every 5 minutes
setInterval(processFailedOperations, 5 * 60 * 1000);
```

**Estimated Time:** 20 hours

---

### 🟡 ISSUE #6: Payment State Machine (HIGH)
**Problem:** Sales state transitions unclear → invalid states possible

**File:** `src/models/sales.model.js`, sales controllers/services  
**Impact:** Confusion about sale status, potential double-processing

**The Fix:**
```javascript
// 1. Define valid state transitions
const SALE_STATE_MACHINE = {
  'pending': ['completed', 'cancelled', 'failed'],
  'completed': ['reconciled'],
  'failed': ['pending'],  // Can retry
  'cancelled': [],         // Terminal
  'reconciled': [],        // Terminal
};

// 2. Enforce on every state change
async function updateSaleStatus(saleId, newStatus) {
  const [sale] = await db.select()
    .from(sales)
    .where(eq(sales.id, saleId))
    .limit(1);
  
  const validTransitions = SALE_STATE_MACHINE[sale.status] || [];
  if (!validTransitions.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${sale.status} → ${newStatus}`
    );
  }
  
  return await db.update(sales)
    .set({
      payment_status: newStatus,
      updated_at: new Date(),
    })
    .where(eq(sales.id, saleId))
    .returning();
}

// 3. Use in controllers
await updateSaleStatus(saleId, 'completed');
// Will throw error if sale is already 'cancelled'
```

**Estimated Time:** 12 hours

---

### 🟢 ISSUE #7: Data Encryption (MEDIUM)
**Problem:** Payment credentials in plain text → security vulnerability

**File:** `src/models/paymentConfig.model.js`  
**Impact:** If database is hacked, M-Pesa credentials exposed  
**Likelihood:** Low (depends on infrastructure security)

**The Fix:**
```javascript
import crypto from 'crypto';

// 1. Encrypt sensitive fields
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32-byte key

async function encryptField(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

async function decryptField(encrypted) {
  const [iv, text] = encrypted.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(ENCRYPTION_KEY),
    Buffer.from(iv, 'hex')
  );
  let decrypted = decipher.update(text, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// 2. Update paymentConfig controller
const encryptedTillNumber = await encryptField(req.body.till_number);
const config = await db.insert(paymentConfigs).values({
  business_id: businessId,
  till_number: encryptedTillNumber,  // Stored encrypted
  payment_type: 'till',
});

// 3. When retrieving, decrypt automatically
const config = await db.select().from(paymentConfigs).where(...);
config.till_number = await decryptField(config.till_number);
```

**Estimated Time:** 16 hours

---

### 🟢 ISSUE #8: Input Validation (MEDIUM)
**Problem:** No amount limits or duplicate detection → accidental overpayments

**File:** `src/validations/`, sales/payment controllers  
**Impact:** User sends 100,000 KSH instead of 1,000 by mistake  
**Likelihood:** Low (user error, not system error)

**The Fix:**
```javascript
// 1. Add validation schema
const tokenPurchaseSchema = z.object({
  businessId: z.number().min(1),
  packageType: z.enum(['10', '30', '50', '100']),
  phone: z.string().regex(/^\+?254\d{9}$/),
  // Prevent duplicate within 60 seconds
  idempotency_key: z.string().optional(),
});

// 2. Add amount sanity checks
const createSaleSchema = z.object({
  items: z.array(
    z.object({
      product_id: z.number(),
      quantity: z.number().min(1).max(10000), // Reasonable limits
      unit_price: z.number().min(1).max(1000000), // 1M KSH max per item
    })
  ),
  // Max sale per day: 10M KSH
  // Enforced in controller
});

// 3. Detect duplicates
async function checkDuplicate(businessId, phone, amount, window = 60) {
  const recent = await db.select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.business_id, businessId),
        gte(
          walletTransactions.created_at,
          new Date(Date.now() - window * 1000)
        ),
        eq(walletTransactions.phone, phone),
        eq(walletTransactions.amount, amount),
        eq(walletTransactions.type, 'purchase')
      )
    )
    .limit(1);
  
  if (recent.length > 0) {
    throw new Error('Duplicate purchase detected - already processing');
  }
}

// 4. In controller
const validationResult = tokenPurchaseSchema.safeParse(req.body);
if (!validationResult.success) {
  return res.status(400).json({ error: 'Invalid input' });
}

await checkDuplicate(
  businessId,
  validationResult.data.phone,
  tokenValue
);
```

**Estimated Time:** 10 hours

---

## Implementation Roadmap

### Week 1: Critical Atomicity Fixes
- [ ] Issue #1: Transaction atomicity (8h)
- [ ] Issue #2: Idempotency handling (12h)
- [ ] Issue #3: Credit ledger atomicity (8h)
- **Total: 28h (3-4 days for 2 developers)**

### Week 2-3: Safety & Recovery
- [ ] Issue #4: Audit logging (16h)
- [ ] Issue #5: Error recovery (20h)
- **Total: 36h (4-5 days for 2 developers)**

### Week 4: Polish
- [ ] Issue #6: State machine (12h)
- [ ] Issue #7: Encryption (16h)
- [ ] Issue #8: Validation (10h)
- [ ] Testing & integration (20h)
- **Total: 58h (1 week for 2 developers)**

**Grand Total:** 122 hours = ~2-3 weeks for 2 senior developers

---

## Quick Testing Checklist

For each fix, test these scenarios:

### Transaction Atomicity
- [ ] Create sale, system crashes mid-transaction, resume - no duplicates
- [ ] 100 concurrent sales against 100 available items - exactly 100 sales, no overselling
- [ ] Stock availability check returns false - sale rejected, no record created

### Idempotency
- [ ] Same M-Pesa callback received 5 times - tokens credited once
- [ ] Different callbacks for same amount - both processed
- [ ] Duplicate within 1-second window - rejected

### Atomic Ledger
- [ ] Credit sale created, system crashes before ledger - both created or both rolled back
- [ ] Payment received, system crashes before ledger - refund or verify payment

### Audit Logging
- [ ] Every financial transaction has audit log entry
- [ ] Timestamp, user_id, ip_address all captured
- [ ] Cannot delete or modify audit logs (immutable)

### Error Recovery
- [ ] Failed M-Pesa callback retried automatically
- [ ] After 5 retries, marked failed and alert sent
- [ ] Exponential backoff applied (1s, 2s, 4s, 8s, 16s)

### State Machine
- [ ] Pending → Completed → Reconciled (valid)
- [ ] Completed → Pending (invalid - rejected)
- [ ] Completed → Cancelled (invalid - rejected)

---

## Commands to Get Started

```bash
# Start development server with watch
npm run dev

# Check current test status
npm test

# Run tests for specific file
npm test -- myWallet.service.test.js

# Fix ESLint errors
npm run lint:fix

# Format code
npm run format

# Open database GUI to inspect data
npm run db:studio
```

---

## Questions to Ask Before Starting

1. **When is production launch?** (Critical for prioritization)
2. **Current data volume?** (Affects migration complexity)
3. **Existing customer transactions?** (Affects rollback strategy)
4. **Available developer time?** (2 weeks for one dev vs 1 week for two?)
5. **M-Pesa sandbox still active?** (Can test issues #2, #4)

---

**Remember:** These fixes are the difference between "works" and "works reliably."

Start with Issues #1-3 (critical atomicity). Everything else can follow.

Good luck! 🚀

