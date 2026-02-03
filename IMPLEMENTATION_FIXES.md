## 🔧 IMPLEMENTATION GUIDE: Financial Transaction Safety
### Step-by-Step Fixes for Critical Issues

---

## ISSUE #1: Transaction Atomicity in Sales

### Current Problem
```javascript
// ❌ WRONG - Stock deduction outside transaction
await db.transaction(async tx => {
  // Create sale, reserve token, update wallet
});

// Outside transaction:
await deductStockFIFO(...); // ← DANGEROUS!
```

### The Fix

**File: `src/controllers/sales.controller.js`**

```javascript
// Replace the entire sales creation flow with this:

export const createSaleHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = createSaleSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { businessId, items, customerName, paymentMode, customerType, note } =
      validationResult.data;

    // Pre-flight checks (outside transaction)
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, businessId), eq(businesses.user_id, req.user.id))
      )
      .limit(1);

    if (!business) {
      return res
        .status(403)
        .json({ error: 'Business not found or access denied' });
    }

    // Verify all items have valid product_id, quantity, unit_price
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item required' });
    }

    // === NOW ENTER TRANSACTION ===
    const result = await db.transaction(async tx => {
      const createdAt = new Date();
      const tokenFee = 1;

      // STEP 1: Lock wallet and verify balance
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.business_id, businessId))
        .limit(1)
        .for('update'); // ← PESSIMISTIC LOCK

      if (!wallet) {
        throw new Error('Wallet not found for business');
      }

      if (wallet.balance_tokens < tokenFee) {
        throw new Error(
          `Insufficient tokens. Required: ${tokenFee}, ` +
          `Available: ${wallet.balance_tokens}`
        );
      }

      // STEP 2: Verify all stock exists BEFORE creating sale
      const stockChecks = [];
      for (const item of items) {
        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, item.product_id))
          .limit(1);

        if (!product) {
          throw new Error(`Product ${item.product_id} not found`);
        }

        // Get batches in FIFO order and verify sufficient stock
        const availableBatches = await tx
          .select()
          .from(stockBatches)
          .where(
            and(
              eq(stockBatches.product_id, item.product_id),
              gt(stockBatches.quantity_available, 0)
            )
          )
          .orderBy(asc(stockBatches.created_at));

        let totalAvailable = 0;
        for (const batch of availableBatches) {
          totalAvailable += Number(batch.quantity_available);
        }

        if (totalAvailable < item.quantity) {
          throw new Error(
            `Insufficient stock for product ${product.name}. ` +
            `Required: ${item.quantity}, Available: ${totalAvailable}`
          );
        }

        stockChecks.push({
          productId: item.product_id,
          productName: product.name,
          requiredQty: item.quantity,
          batches: availableBatches,
        });
      }

      // STEP 3: Calculate totals
      const totalAmount = items.reduce(
        (sum, item) => sum + Number(item.quantity) * Number(item.unit_price),
        0
      );

      const totalProfit = items.reduce((sum, item) => {
        const cost = Number(item.unit_cost || 0);
        const revenue = Number(item.quantity) * Number(item.unit_price);
        return sum + revenue - (Number(item.quantity) * cost);
      }, 0);

      // STEP 4: Create sale
      const [sale] = await tx
        .insert(sales)
        .values({
          business_id: businessId,
          total_amount: String(totalAmount.toFixed(2)),
          total_profit: String(totalProfit.toFixed(2)),
          payment_mode: paymentMode,
          token_fee: tokenFee,
          status: 'pending',
          payment_status: 'pending',
          customer_type: customerType || 'walk_in',
          customer_name: customerName || null,
          note: note || null,
          created_at: createdAt,
          updated_at: createdAt,
        })
        .returning();

      // STEP 5: Create sale items
      const saleItemIds = [];
      for (const item of items) {
        const [saleItem] = await tx
          .insert(saleItems)
          .values({
            sale_id: sale.id,
            product_id: item.product_id,
            quantity: String(item.quantity),
            unit_price: String(item.unit_price),
            total_price: String(
              (Number(item.quantity) * Number(item.unit_price)).toFixed(2)
            ),
            unit_cost: String(item.unit_cost || 0),
            profit: String(
              (
                Number(item.quantity) *
                (Number(item.unit_price) - Number(item.unit_cost || 0))
              ).toFixed(2)
            ),
            created_at: createdAt,
          })
          .returning();

        saleItemIds.push(saleItem.id);
      }

      // STEP 6: Deduct stock using FIFO (INSIDE TRANSACTION!)
      for (const check of stockChecks) {
        const item = items.find((i) => i.product_id === check.productId);
        let remainingQty = item.quantity;

        for (const batch of check.batches) {
          if (remainingQty <= 0) break;

          const qtyFromBatch = Math.min(
            remainingQty,
            Number(batch.quantity_available)
          );

          // Update batch
          await tx
            .update(stockBatches)
            .set({
              quantity_available: Number(batch.quantity_available) - qtyFromBatch,
              updated_at: createdAt,
            })
            .where(eq(stockBatches.id, batch.id));

          // Log movement
          await tx.insert(stockMovements).values({
            business_id: businessId,
            product_id: check.productId,
            batch_id: batch.id,
            quantity: qtyFromBatch,
            movement_type: 'sale',
            reference_type: 'sale',
            reference_id: sale.id,
            unit_cost: batch.unit_cost,
            created_at: createdAt,
          });

          remainingQty -= qtyFromBatch;
        }

        if (remainingQty > 0) {
          throw new Error(
            `CRITICAL: Failed to deduct all stock for product ${check.productId}`
          );
        }
      }

      // STEP 7: Reserve token from wallet
      await tx
        .update(wallets)
        .set({
          balance_tokens: wallet.balance_tokens - tokenFee,
          updated_at: createdAt,
        })
        .where(eq(wallets.id, wallet.id));

      // Log transaction
      await tx.insert(walletTransactions).values({
        business_id: businessId,
        change_tokens: -tokenFee,
        type: 'reserve',
        reference: String(sale.id),
        note: 'Sale token reservation',
        created_at: createdAt,
      });

      logger.info(
        `Sale created: ID=${sale.id}, Amount=${totalAmount}, Items=${items.length}`
      );

      return {
        saleId: sale.id,
        totalAmount,
        totalProfit,
        itemCount: items.length,
      };
    });

    // === TRANSACTION COMPLETE ===
    // Either everything succeeded, or nothing changed

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Sale creation failed', error);
    if (error.message.includes('Insufficient')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
};
```

**Key Changes:**
- ✅ All stock deduction INSIDE `db.transaction`
- ✅ Wallet locked with `.for('update')` to prevent race conditions
- ✅ Stock verified before ANY updates
- ✅ All state changes atomic - succeeds completely or rolls back

---

## ISSUE #2: Payment Idempotency

### Current Problem
User clicks "Pay" twice → two M-Pesa requests → potentially charged twice

### The Fix

**File: `src/controllers/sales.controller.js` - Add this handler:**

```javascript
export const payMpesaHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = payMpesaSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { saleId, phone } = validationResult.data;

    // STEP 1: Get sale and verify ownership
    const [sale] = await db
      .select({
        sale: sales,
        business: businesses,
      })
      .from(sales)
      .innerJoin(businesses, eq(sales.business_id, businesses.id))
      .where(
        and(
          eq(sales.id, saleId),
          eq(businesses.user_id, req.user.id)
        )
      )
      .limit(1);

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    if (sale.sale.payment_status === 'completed') {
      return res.status(400).json({
        error: 'Sale already paid',
        paidAt: sale.sale.paid_at,
      });
    }

    // STEP 2: CRITICAL - Check for duplicate payment requests
    const [existingPayment] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.sale_id, saleId),
          eq(payments.status, 'pending') // Only pending - not completed/failed
        )
      )
      .limit(1);

    if (existingPayment) {
      return res.status(409).json({
        error: 'Payment already in progress',
        paymentId: existingPayment.id,
        requestId: existingPayment.stk_request_id,
        message: 'Complete the existing payment or wait 10 minutes to retry',
      });
    }

    // STEP 3: Create payment record BEFORE M-Pesa call
    // This is our idempotency key
    const createdAt = new Date();
    const [payment] = await db
      .insert(payments)
      .values({
        sale_id: saleId,
        business_id: sale.sale.business_id,
        phone,
        amount: sale.sale.total_amount,
        payment_method: 'mpesa',
        status: 'pending',
        created_at: createdAt,
      })
      .returning();

    logger.info(
      `Payment initiated: ID=${payment.id}, Sale=${saleId}, Amount=${payment.amount}`
    );

    // STEP 4: Initiate M-Pesa STK push
    let mpesaResp;
    try {
      mpesaResp = await initiateBusinessPayment({
        phone,
        amount: Number(payment.amount),
        accountReference: `PAYMENT-${payment.id}`, // ← Unique reference
      });
    } catch (mpesaError) {
      // Mark payment as failed
      await db
        .update(payments)
        .set({
          status: 'failed',
          failure_reason: mpesaError.message,
          updated_at: new Date(),
        })
        .where(eq(payments.id, payment.id));

      logger.error(`M-Pesa STK push failed: ${mpesaError.message}`, mpesaError);

      return res.status(400).json({
        error: 'Failed to initiate payment',
        message: 'M-Pesa service unavailable. Please try again later.',
      });
    }

    // STEP 5: Store STK request ID for callback matching
    await db
      .update(payments)
      .set({
        stk_request_id: mpesaResp.CheckoutRequestID,
        callback_payload: JSON.stringify(mpesaResp),
        updated_at: new Date(),
      })
      .where(eq(payments.id, payment.id));

    res.json({
      success: true,
      paymentId: payment.id,
      requestId: mpesaResp.CheckoutRequestID,
      amount: payment.amount,
      phone,
    });
  } catch (error) {
    logger.error('Payment initialization failed', error);
    next(error);
  }
};
```

**Key Changes:**
- ✅ Check for existing pending payment BEFORE M-Pesa call
- ✅ Create payment record (idempotency key)
- ✅ Return error if user tries duplicate payment
- ✅ User told to wait or complete existing payment

---

## ISSUE #3: Credit Sale Validation

### Current Problem
Can create credit sale that exceeds credit limit without validation

### The Fix

**File: `src/services/credit.service.js` - Update createCreditSale:**

```javascript
export const createCreditSale = async (
  userId,
  businessId,
  accountId,
  saleAmount,
  dueDate,
  items = [] // Sale items
) => {
  try {
    return await db.transaction(async tx => {
      // STEP 1: Get account with exclusive lock
      const [account] = await tx
        .select()
        .from(creditAccounts)
        .where(
          and(
            eq(creditAccounts.id, accountId),
            eq(creditAccounts.business_id, businessId)
          )
        )
        .limit(1)
        .for('update'); // ← Lock prevents concurrent updates

      if (!account) {
        throw new Error('Credit account not found');
      }

      // STEP 2: Validate account is active
      if (!account.is_active) {
        throw new Error(
          `Credit account is inactive. ` +
          `Contact support to reactivate.`
        );
      }

      // STEP 3: Validate credit limit NOT exceeded
      const currentBalance = Number(account.balance_due);
      const creditLimit = Number(account.credit_limit);
      const newBalance = currentBalance + saleAmount;

      if (newBalance > creditLimit) {
        const available = creditLimit - currentBalance;
        throw new Error(
          `Credit limit exceeded. ` +
          `Limit: KSH ${creditLimit}, ` +
          `Current Balance: KSH ${currentBalance}, ` +
          `Available: KSH ${available}, ` +
          `Requested: KSH ${saleAmount}`
        );
      }

      // STEP 4: Validate due date
      const dueDateTime = new Date(dueDate).getTime();
      const nowTime = new Date().getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;

      if (dueDateTime <= nowTime) {
        throw new Error('Due date must be in the future');
      }

      if (dueDateTime - nowTime < oneDayMs) {
        logger.warn(`Due date less than 1 day away: ${dueDate}`);
      }

      // STEP 5: Create credit sale
      const createdAt = new Date();
      const [creditSale] = await tx
        .insert(creditSales)
        .values({
          account_id: accountId,
          due_date: dueDate,
          outstanding_amount: String(saleAmount.toFixed(2)),
          status: 'open',
          created_at: createdAt,
        })
        .returning();

      // STEP 6: Update account balance
      const [updatedAccount] = await tx
        .update(creditAccounts)
        .set({
          balance_due: String(newBalance.toFixed(2)),
          updated_at: createdAt,
        })
        .where(eq(creditAccounts.id, accountId))
        .returning();

      // STEP 7: Add to ledger (audit trail)
      await tx.insert(creditLedger).values({
        account_id: accountId,
        type: 'sale',
        amount: String(saleAmount.toFixed(2)),
        balance_after: String(newBalance.toFixed(2)),
        reference: String(creditSale.id),
        note: `Credit sale created. Due: ${dueDate}`,
        created_at: createdAt,
      });

      logger.info(
        `Credit sale created: ` +
        `Account=${accountId}, ` +
        `Amount=${saleAmount}, ` +
        `NewBalance=${newBalance}`
      );

      return creditSale;
    });
  } catch (error) {
    logger.error('Credit sale creation failed', error);
    throw error;
  }
};
```

**Key Changes:**
- ✅ Lock account to prevent concurrent updates
- ✅ Verify account is active
- ✅ Verify credit limit not exceeded
- ✅ Validate due date is in future
- ✅ Every change logged to ledger

---

## ISSUE #4: Wallet Reconciliation

### Current Problem
Wallet balance can drift from actual transactions without detection

### The Fix

**File: `src/services/reconciliation.service.js` (NEW FILE)**

```javascript
import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, sum } from 'drizzle-orm';
import { wallets, walletTransactions } from '#models/myWallet.model.js';

/**
 * Reconcile wallet balance against transaction ledger
 * Run nightly to detect corruption
 */
export const reconcileWalletBalance = async (businessId) => {
  try {
    logger.info(`Starting wallet reconciliation for business ${businessId}`);

    // Get current wallet
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.business_id, businessId))
      .limit(1);

    if (!wallet) {
      throw new Error(`Wallet not found for business ${businessId}`);
    }

    // Calculate expected balance from transactions
    const [result] = await db
      .select({
        total: sum(walletTransactions.change_tokens).cast('integer'),
        count: count(walletTransactions.id),
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId));

    const calculatedBalance = result.total || 0;
    const actualBalance = wallet.balance_tokens;
    const discrepancy = calculatedBalance - actualBalance;

    // Check if balanced
    if (discrepancy === 0) {
      logger.info(`✅ Wallet reconciled: Business ${businessId}, Balance=${actualBalance}`);
      return {
        reconciled: true,
        balance: actualBalance,
        transactionCount: result.count,
      };
    }

    // DISCREPANCY FOUND!
    logger.error(
      `❌ WALLET RECONCILIATION FAILED: ` +
      `Business=${businessId}, ` +
      `Expected=${calculatedBalance}, ` +
      `Actual=${actualBalance}, ` +
      `Discrepancy=${discrepancy}`
    );

    // Create incident record
    await db.insert(reconciliationIncidents).values({
      business_id: businessId,
      table_name: 'wallets',
      record_id: wallet.id,
      expected_value: String(calculatedBalance),
      actual_value: String(actualBalance),
      discrepancy: String(discrepancy),
      transaction_count: result.count,
      resolved: false,
      created_at: new Date(),
    });

    // ALERT OPERATIONS
    await notifyAdmins({
      severity: 'CRITICAL',
      title: `Wallet Balance Discrepancy`,
      message: `Business ${businessId}: Expected ${calculatedBalance}, got ${actualBalance}`,
      discrepancy,
      businessId,
    });

    return {
      reconciled: false,
      balance: actualBalance,
      expectedBalance: calculatedBalance,
      discrepancy,
      incidentCreated: true,
    };
  } catch (error) {
    logger.error('Wallet reconciliation error', error);
    throw error;
  }
};

/**
 * Run reconciliation for ALL businesses (nightly job)
 */
export const reconcileAllWallets = async () => {
  try {
    logger.info('Starting global wallet reconciliation...');

    const allBusinesses = await db
      .select({ id: businesses.id })
      .from(businesses);

    let successCount = 0;
    let failureCount = 0;

    for (const business of allBusinesses) {
      try {
        const result = await reconcileWalletBalance(business.id);
        if (result.reconciled) {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (error) {
        logger.error(`Reconciliation error for business ${business.id}`, error);
        failureCount++;
      }
    }

    logger.info(
      `Reconciliation complete: Success=${successCount}, Failures=${failureCount}`
    );

    return { successCount, failureCount };
  } catch (error) {
    logger.error('Global reconciliation failed', error);
    throw error;
  }
};
```

**Key Changes:**
- ✅ Calculate actual balance from transactions
- ✅ Compare with stored balance
- ✅ Create incident if mismatch found
- ✅ Alert operations team
- ✅ Can run nightly as background job

**Add to `src/routes/admin.routes.js`:**

```javascript
// Manual reconciliation trigger (admin only)
router.post('/reconcile/wallet/:businessId', requireRole('admin'), async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const result = await reconcileWalletBalance(businessId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// Trigger nightly reconciliation
router.post('/reconcile/all-wallets', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await reconcileAllWallets();
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
```

---

## TESTING THE FIXES

### Unit Test Example: Transaction Atomicity

**File: `tests/sales.transaction.test.js`**

```javascript
describe('Sales Transaction Atomicity', () => {
  test('should roll back entire sale if stock deduction fails', async () => {
    const businessId = 1;
    const items = [
      { product_id: 1, quantity: 100, unit_price: 1000, unit_cost: 500 },
    ];

    // Setup: Only 50 units available
    await setupStock(1, 50);

    // Attempt to sell 100 units
    const promise = createSaleHandler(businessId, items);

    // Should fail
    await expect(promise).rejects.toThrow('Insufficient stock');

    // Verify: No partial sale created
    const sales = await db
      .select()
      .from(sales)
      .where(eq(sales.business_id, businessId));
    
    expect(sales).toHaveLength(0);

    // Verify: Wallet not debited
    const wallet = await db
      .select()
      .from(wallets)
      .where(eq(wallets.business_id, businessId))
      .limit(1);

    expect(wallet[0].balance_tokens).toBe(initialBalance);
  });

  test('should deduct stock in FIFO order', async () => {
    // Setup two batches
    const batch1 = await setupBatch(1, 30, 100); // 30 units, cost 100
    const batch2 = await setupBatch(1, 50, 110); // 50 units, cost 110

    // Sell 40 units
    await createSaleHandler(businessId, [
      { product_id: 1, quantity: 40, unit_price: 150 },
    ]);

    // Should use all of batch1 (30) + 10 from batch2
    const b1 = await getStockBatch(batch1.id);
    const b2 = await getStockBatch(batch2.id);

    expect(b1.quantity_available).toBe(0);   // Fully consumed
    expect(b2.quantity_available).toBe(40);  // 50 - 10
  });
});
```

### Integration Test: Payment Idempotency

```javascript
describe('Payment Idempotency', () => {
  test('should reject duplicate payment requests', async () => {
    const saleId = await createSale(100000);

    // First payment request
    const response1 = await payMpesaHandler(saleId, '+254712345678');
    expect(response1.success).toBe(true);

    // Duplicate payment request
    const response2 = await payMpesaHandler(saleId, '+254712345678');
    
    expect(response2.status).toBe(409);
    expect(response2.error).toContain('already in progress');
    expect(response2.paymentId).toBe(response1.paymentId);
  });
});
```

---

## DEPLOYMENT CHECKLIST

- [ ] All transaction code reviewed (sales, credit, wallet)
- [ ] Transaction locks added (`.for('update')`)
- [ ] Idempotency checks implemented
- [ ] Validation added to critical operations
- [ ] Reconciliation service created and tested
- [ ] Unit tests written for each fix
- [ ] Integration tests pass
- [ ] Load test with concurrent requests
- [ ] Staging environment validation
- [ ] Backup strategy documented
- [ ] Rollback plan documented
- [ ] Operations manual updated
- [ ] Team trained on new code
- [ ] Monitoring alerts configured

---

**Status:** Ready for implementation  
**Effort:** 2-3 weeks  
**Risk:** Low (fixes are additive, don't remove existing code)
