// controllers/credit.controller.js
import { db } from '#config/database.js';
// Token deduction centralized in `createRecord` service
import {
  creditAccounts,
  creditLedger,
  creditSales,
  creditPayments,
} from '#models/credit.model.js';
import { sales, saleItems } from '#models/sales.model.js';
import { businesses } from '#models/setting.model.js';
import { customers } from '#models/customer.model.js';
import { eq, and, inArray } from 'drizzle-orm';
import { calculateCreditRepayment } from '#services/financialCalculations.js';
import {
  createCreditAccountSchema,
  createCreditSaleSchema,
  recordCreditPaymentSchema,
} from '#validations/credit.validation.js';
import { formatValidationError } from '#utils/format.js';
import logger from '#config/logger.js';
import {
  AuthorizationError,
  DatabaseError,
} from '#middleware/errorHandler.middleware.js';
import { catchAsync } from '#utils/catchAsync.js';
import * as creditService from '#services/credit.service.js';
import * as recordService from '#services/record.service.js';
import { getCreditSalesForBusiness } from '#services/credit.service.js';
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

async function assertBusinessOwnership(userId, businessId) {
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) {
    throw new AuthorizationError('Business not found or access denied');
  }
}

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Resolve the receivable a credit repayment is being applied against, so
 * calculateCreditRepayment() can run cost-recovery-first — exactly the
 * basis higherPurchase.service.js hands calculateHPPayment():
 *
 *   totalSaleValue                  ← the debt originally opened
 *   totalCost                       ← the real FIFO cost of those goods
 *   amountReceivedBeforeThisPayment ← value − what's still outstanding
 *
 * Two scopes, because recordCreditPaymentSchema makes saleId optional:
 *  - saleId given  → just that one credit sale.
 *  - no saleId     → the account as a single running receivable. ALL of
 *    the account's credit sales are included, settled ones too. That's
 *    deliberate: the cost-recovery curve has to stay continuous across
 *    the account's whole history, otherwise cost already recovered by
 *    earlier payments would be charged for a second time.
 *
 * Cost basis is SUM(sale_items.unit_cost × quantity) — the same
 * expression getStatementFinancials() uses for credit COGS, so the
 * profit written here can never disagree with the statement's cost side.
 *
 * Outstanding comes from credit_sales.outstanding_amount, not
 * credit_accounts.balance_due, so value and outstanding are derived from
 * the same set of rows.
 *
 * MUST be called before the credit_sales / credit_accounts rows are
 * updated for this payment — it reads the pre-payment outstanding.
 *
 * Throws rather than degrading to zero if the receivable can't be
 * resolved. A zero here is indistinguishable from "this payment was
 * genuinely all cost recovery", which is precisely the silent-wrong-
 * number failure this whole change exists to remove. Failing the
 * transaction rolls the payment back, so the operator retries against
 * a fixed row instead of banking a fabricated profit figure.
 */
async function resolveCreditReceivableBasis(tx, accountId, saleId) {
  const scoped = await tx
    .select({
      id: creditSales.id,
      sale_id: creditSales.sale_id,
      outstanding_amount: creditSales.outstanding_amount,
    })
    .from(creditSales)
    .where(
      saleId
        ? and(
          eq(creditSales.account_id, accountId),
          eq(creditSales.sale_id, saleId)
        )
        : eq(creditSales.account_id, accountId)
    );

  if (scoped.length === 0) {
    throw new DatabaseError(
      `Cannot split credit payment: no credit_sales rows for account ${accountId}` +
        `${saleId ? ` and sale ${saleId}` : ''}. Refusing to record a payment ` +
        'with an unverifiable cost/profit split.'
    );
  }

  // credit_sales.sale_id is nullable, and inArray() with a null in the
  // list is not a query we can reason about — drop them and insist on
  // what's left, rather than silently costing the nulls at zero.
  const saleIds = [...new Set(scoped.map(cs => cs.sale_id).filter(Boolean))];

  if (saleIds.length !== scoped.length) {
    throw new DatabaseError(
      `Cannot split credit payment: ${scoped.length - saleIds.length} of ` +
        `${scoped.length} credit_sales rows for account ${accountId} have no ` +
        'sale_id, so their cost basis is unknowable.'
    );
  }

  const saleRows = await tx
    .select({ id: sales.id, total_amount: sales.total_amount })
    .from(sales)
    .where(inArray(sales.id, saleIds));

  if (saleRows.length !== saleIds.length) {
    throw new DatabaseError(
      `Cannot split credit payment: expected ${saleIds.length} sales rows for ` +
        `account ${accountId}, found ${saleRows.length}. A missing sale would ` +
        'understate the receivable and overstate profit.'
    );
  }

  const itemRows = await tx
    .select({
      sale_id: saleItems.sale_id,
      unit_cost: saleItems.unit_cost,
      quantity: saleItems.quantity,
    })
    .from(saleItems)
    .where(inArray(saleItems.sale_id, saleIds));

  // No line items means no cost basis, which would price this payment as
  // 100% profit — the original bug exactly. Every sale must contribute.
  const salesWithItems = new Set(itemRows.map(i => i.sale_id));
  const missingItems = saleIds.filter(id => !salesWithItems.has(id));
  if (missingItems.length > 0) {
    throw new DatabaseError(
      `Cannot split credit payment: sales [${missingItems.join(', ')}] on ` +
        `account ${accountId} have no sale_items, so there is no cost basis. ` +
        'Refusing to record the payment as pure profit.'
    );
  }

  const totalSaleValue = round2(
    saleRows.reduce((sum, r) => sum + Number(r.total_amount), 0)
  );
  const totalCost = round2(
    itemRows.reduce(
      (sum, i) => sum + Number(i.unit_cost) * Number(i.quantity),
      0
    )
  );
  const outstandingNow = scoped.reduce(
    (sum, cs) => sum + Number(cs.outstanding_amount),
    0
  );

  return {
    totalCost,
    totalSaleValue,
    amountReceivedBeforeThisPayment: round2(
      Math.max(totalSaleValue - outstandingNow, 0)
    ),
  };
}

export async function createCreditAccount(req, res, next) {
  const requestId = req.revenueGuard?.request_id;

  try {
    const parsed = createCreditAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.format(),
        request_id: requestId,
      });
    }

    const { businessId, customerId, customerName, creditLimit } = parsed.data;
    await assertBusinessOwnership(req.user.id, businessId);

    let accountId;
    await db.transaction(async tx => {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, customerId),
            eq(customers.business_id, businessId)
          )
        )
        .limit(1);

      if (!customer) {
        throw new AuthorizationError('Customer not found or access denied');
      }

      const [row] = await tx
        .insert(creditAccounts)
        .values({
          business_id: businessId,
          customer_id: customerId,
          customer_name: customerName,
          credit_limit: creditLimit || 0,
          balance_due: 0,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      accountId = row.id;

      // Create initial ledger entry
      await tx.insert(creditLedger).values({
        account_id: row.id,
        type: 'account_open',
        amount: 0,
        balance_after: 0,
        reference: null,
        note: 'Account opened',
        created_at: new Date(),
      });

      // Create a revenue record (token deduction) atomically within the same transaction
      await recordService.createRecord(
        {
          business_id: businessId,
          user_id: req.user.id,
          type: 'credit',
          category: 'account_open',
          amount: 0,
          transaction_date: new Date(),
          description: `Credit account opened for ${customerName}`,
        },
        tx
      );
    });

    logger.info(
      `Credit account created for customer ${customerName} (ID: ${accountId})`,
      { request_id: requestId }
    );
    res.status(201).json({
      message: 'Credit account created successfully',
      account: { id: accountId, customer_name: customerName },
      tokens_remaining: req.revenueGuard.balance_before - 1,
      request_id: requestId,
    });
  } catch (err) {
    logger.error('Error creating credit account', {
      error: err.message,
      request_id: requestId,
    });

    // Token refunds are handled within `createRecord` transaction if needed

    next(err);
  }
}

export async function createCreditSale(req, res, next) {
  const requestId = req.revenueGuard?.request_id;

  try {
    const parsed = createCreditSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(parsed.error),
        request_id: requestId,
      });
    }

    const { businessId, saleId, accountId, dueDate, outstandingAmount } =
      parsed.data;
    await assertBusinessOwnership(req.user.id, businessId);
    let creditSaleId;
    let customerName;
    let balanceRemaining;

    await db.transaction(async tx => {
      // Verify the sale exists and is a credit sale
      const [sale] = await tx
        .select()
        .from(sales)
        .where(eq(sales.id, saleId))
        .limit(1);

      if (!sale) {
        throw new Error('Sale not found');
      }

      if (sale.business_id !== businessId) {
        throw new Error('Sale not found');
      }

      if (sale.customer_type !== 'credit') {
        throw new Error('Sale is not a credit sale');
      }

      // Verify the credit account exists
      const [account] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.id, accountId))
        .limit(1);

      if (!account) {
        throw new Error('Credit account not found');
      }

      if (account.business_id !== businessId) {
        throw new Error('Credit account not found');
      }
      customerName = account.customer_name;

      // Check if adding this sale would exceed credit limit
      const newBalance =
        Number(account.balance_due) + Number(outstandingAmount);
      balanceRemaining = newBalance;
      if (
        Number(account.credit_limit) > 0 &&
        newBalance > Number(account.credit_limit)
      ) {
        throw new Error(
          `Credit limit exceeded. Limit: ${account.credit_limit}, Current: ${account.balance_due}, Requested: ${outstandingAmount}`
        );
      }

      // Create credit sale record
      const [creditSale] = await tx
        .insert(creditSales)
        .values({
          sale_id: saleId,
          account_id: accountId,
          due_date: new Date(dueDate),
          outstanding_amount: String(outstandingAmount),
          status: 'open',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      creditSaleId = creditSale.id;

      // Update account balance
      await tx
        .update(creditAccounts)
        .set({
          balance_due: String(newBalance),
          updated_at: new Date(),
        })
        .where(eq(creditAccounts.id, accountId));

      // Create ledger entry
      await tx.insert(creditLedger).values({
        account_id: accountId,
        type: 'sale',
        amount: String(outstandingAmount),
        balance_after: String(newBalance),
        reference: String(saleId),
        note: `Credit sale #${saleId}`,
        created_at: new Date(),
      });

      // Create corresponding revenue record (deduct token) inside same transaction
      await recordService.createRecord(
        {
          business_id: businessId,
          user_id: req.user.id,
          type: 'credit',
          category: 'credit_sale',
          amount: Number(outstandingAmount),
          transaction_date: new Date(),
          description: `Credit sale #${saleId} to account #${accountId}`,
          items: [
            {
              item_name: `Credit sale #${saleId}`,
              quantity: 1,
              unit_price: Number(outstandingAmount),
            },
          ],
        },
        tx
      );
    });

    emitNotification({
      user_id: req.user.id,
      business_id: businessId,
      ...notifications.creditSaleCreated({
        credit_sale_id: creditSaleId,
        amount: Number(outstandingAmount),
        customer_name: customerName,
        balance_remaining: balanceRemaining,
        business_id: businessId,
      }),
    }).catch(error =>
      logger.error('Failed to emit credit sale notification', {
        creditSaleId,
        error: error.message,
      })
    );

    logger.info(
      `Credit sale created: Sale #${saleId} linked to account #${accountId}`,
      { request_id: requestId }
    );
    res.status(201).json({
      message: 'Credit sale created successfully',
      creditSaleId,
      tokens_remaining: req.revenueGuard.balance_before - 1,
      request_id: requestId,
    });
  } catch (err) {
    logger.error('Error creating credit sale', {
      error: err.message,
      request_id: requestId,
    });

    // Token refunds are handled within `createRecord` transaction if needed

    if (
      err.message.includes('not found') ||
      err.message.includes('not a credit sale')
    ) {
      return res.status(404).json({
        error: err.message,
        request_id: requestId,
      });
    }
    if (err.message.includes('Credit limit exceeded')) {
      return res.status(400).json({
        error: err.message,
        request_id: requestId,
      });
    }
    next(err);
  }
}

/**
 * GET /api/credit/sales/business/:businessId
 * Every credit sale for a business, with customer/phone/products/cost/due
 * date already joined — feeds the Credit records table directly.
 */
export const getCreditSalesHistory = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const result = await getCreditSalesForBusiness(req.user.id, businessId);

    return res.status(200).json({
      message: 'Credit sales retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error getting credit sales', e);
    next(e);
  }
};

export async function recordCreditPayment(req, res, next) {
  try {
    const parsed = recordCreditPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(parsed.error),
      });
    }

    const {
      accountId,
      saleId,
      amount,
      paymentMethod,
      mpesaTransactionId,
      reference,
    } = parsed.data;

    await creditService.getCreditAccountById(req.user.id, accountId);

    let payment;
    let newBalance;
    let paymentAccount;

    await db.transaction(async tx => {
      // Get account
      const [account] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.id, accountId))
        .limit(1);

      if (!account) {
        throw new Error('Credit account not found');
      }
      paymentAccount = account;

      if (saleId) {
        const [creditSale] = await tx
          .select()
          .from(creditSales)
          .where(
            and(
              eq(creditSales.sale_id, saleId),
              eq(creditSales.account_id, accountId)
            )
          )
          .limit(1);

        if (!creditSale) {
          throw new Error('Credit sale not found');
        }
      }

      if (Number(amount) > Number(account.balance_due)) {
        throw new Error('Payment amount exceeds balance due');
      }

      // Split this payment into cost-recovery and profit BEFORE any of the
      // credit_sales / credit_accounts rows below are touched — the basis
      // depends on the pre-payment outstanding.
      // Throws if the receivable can't be resolved — that aborts the
      // transaction rather than writing a payment with a guessed split.
      const basis = await resolveCreditReceivableBasis(tx, accountId, saleId);
      const split = calculateCreditRepayment({
        ...basis,
        paymentAmount: Number(amount),
      });

      // Record payment
      [payment] = await tx
        .insert(creditPayments)
        .values({
          account_id: accountId,
          sale_id: saleId || null,
          amount: String(amount),
          payment_method: paymentMethod,
          mpesa_transaction_id: mpesaTransactionId || null,
          reference: reference || null,
          cost_recovered: String(split.cost_recovered_this_payment),
          profit_realized: String(split.profit_realized_this_payment),
          created_at: new Date(),
        })
        .returning();

      // Update account balance
      newBalance = Number(account.balance_due) - Number(amount);
      await tx
        .update(creditAccounts)
        .set({
          balance_due: String(newBalance),
          last_payment_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(creditAccounts.id, accountId));

      // If payment is for a specific sale, update that sale's status
      if (saleId) {
        const [creditSale] = await tx
          .select()
          .from(creditSales)
          .where(
            and(
              eq(creditSales.sale_id, saleId),
              eq(creditSales.account_id, accountId)
            )
          )
          .limit(1);

        if (creditSale) {
          const remainingAmount =
            Number(creditSale.outstanding_amount) - Number(amount);
          await tx
            .update(creditSales)
            .set({
              outstanding_amount: String(Math.max(0, remainingAmount)),
              status: remainingAmount <= 0 ? 'paid' : 'open',
              updated_at: new Date(),
            })
            .where(eq(creditSales.id, creditSale.id));
        }
      }

      // Create ledger entry
      await tx.insert(creditLedger).values({
        account_id: accountId,
        type: 'payment',
        amount: String(-amount),
        balance_after: String(newBalance),
        reference: mpesaTransactionId || reference || null,
        note: `Payment received - ${paymentMethod}${saleId ? ` for sale #${saleId}` : ''}`,
        created_at: new Date(),
      });

      await recordService.createRecord(
        {
          business_id: account.business_id,
          user_id: req.user.id,
          type: 'credit',
          category: 'credit_payment',
          amount: Number(amount),
          payment_method: paymentMethod,
          transaction_date: new Date(),
          reference_id: `credit-payment-${payment.id}`,
          description: `Payment received from ${account.customer_name}`,
          credit_status: 'paid',
        },
        tx
      );
    });

    emitNotification({
      user_id: req.user.id,
      business_id: paymentAccount.business_id,
      ...notifications.creditPaymentReceived({
        payment_id: payment.id,
        amount: Number(amount),
        customer_name: paymentAccount.customer_name,
        credit_account_id: accountId,
        balance_remaining: newBalance,
        business_id: paymentAccount.business_id,
      }),
    }).catch(error =>
      logger.error('Failed to emit credit payment notification', {
        paymentId: payment.id,
        error: error.message,
      })
    );

    logger.info(
      `Credit payment recorded: ${amount} for account #${accountId}`
    );
    res.status(201).json({
      message: 'Payment recorded successfully',
      payment,
      newBalance,
      tokens_remaining: req.revenueGuard.balance_before - 1,
    });
  } catch (err) {
    logger.error('Error recording credit payment', err);
    if (err.message.includes('Insufficient tokens')) {
      return res.status(402).json({
        error: err.message,
        code: 'PAYMENT_REQUIRED',
      });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('exceeds balance')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// List all credit accounts for business
export const getCreditAccounts = catchAsync(async (req, res) => {
  const { businessId, status, search, page = 1, limit = 20 } = req.query;
  if (!businessId) {
    return res
      .status(400)
      .json({ error: 'businessId query parameter is required' });
  }
  await assertBusinessOwnership(req.user.id, businessId);

  const accounts = await creditService.getCreditAccountsForBusiness(
    req.user.id,
    businessId,
    { status, search, page, limit }
  );

  res.json({
    success: true,
    data: accounts,
  });
});

// Get single credit account
export const getCreditAccount = catchAsync(async (req, res) => {
  const { accountId } = req.params;

  const account = await creditService.getCreditAccountById(
    req.user.id,
    Number(accountId)
  );

  res.json({
    success: true,
    data: account,
  });
});

// Update credit account
export const updateCreditAccount = catchAsync(async (req, res) => {
  const { accountId } = req.params;
  const updates = req.body;

  const account = await creditService.updateCreditAccount(
    req.user.id,
    Number(accountId),
    updates
  );

  res.json({
    success: true,
    message: 'Credit account updated successfully',
    data: account,
  });
});

// Deactivate credit account
export const deactivateCreditAccount = catchAsync(async (req, res) => {
  const { accountId } = req.params;

  await creditService.deactivateCreditAccount(req.user.id, Number(accountId));

  res.json({
    success: true,
    message: 'Credit account deactivated successfully',
  });
});

// Get credit sales for account
export const getCreditSales = catchAsync(async (req, res) => {
  const { accountId } = req.params;
  const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

  const sales = await creditService.getCreditSalesForAccount(
    req.user.id,
    Number(accountId),
    { status, startDate, endDate, page, limit }
  );

  res.json({
    success: true,
    data: sales,
  });
});

// Get single credit sale with details
export const getCreditSale = catchAsync(async (req, res) => {
  const { saleId } = req.params;

  const sale = await creditService.getCreditSaleWithDetails(
    req.user.id,
    Number(saleId)
  );

  res.json({
    success: true,
    data: sale,
  });
});

// Get payments for account
export const getCreditPayments = catchAsync(async (req, res) => {
  const { accountId } = req.params;
  const { startDate, endDate, page = 1, limit = 20 } = req.query;

  const payments = await creditService.getCreditPaymentsForAccount(
    req.user.id,
    Number(accountId),
    { startDate, endDate, page, limit }
  );

  res.json({
    success: true,
    data: payments,
  });
});

// Get ledger entries
export const getCreditLedger = catchAsync(async (req, res) => {
  const { accountId } = req.params;
  const { startDate, endDate, page = 1, limit = 50 } = req.query;

  const ledger = await creditService.getCreditLedgerForAccount(
    req.user.id,
    Number(accountId),
    { startDate, endDate, page, limit }
  );

  res.json({
    success: true,
    data: ledger,
  });
});

// Get credit summary for business
export const getCreditSummary = catchAsync(async (req, res) => {
  const businessId = Number(req.query.businessId);
  if (Number.isNaN(businessId)) {
    return res
      .status(400)
      .json({ error: 'businessId query parameter is required' });
  }
  await assertBusinessOwnership(req.user.id, businessId);

  const summary = await creditService.getCreditSummaryForBusiness(
    req.user.id,
    businessId
  );

  res.json({
    success: true,
    data: summary,
  });
});

// Get aging report
export const getAgingReport = catchAsync(async (req, res) => {
  const businessId = Number(req.query.businessId);
  if (Number.isNaN(businessId)) {
    return res
      .status(400)
      .json({ error: 'businessId query parameter is required' });
  }
  await assertBusinessOwnership(req.user.id, businessId);

  const report = await creditService.getAgingReport(req.user.id, businessId);

  res.json({
    success: true,
    data: report,
  });
});

// Get customer statement
export const getCustomerStatement = catchAsync(async (req, res) => {
  const { accountId } = req.params;
  const { startDate, endDate } = req.query;

  const statement = await creditService.getCustomerStatement(
    req.user.id,
    Number(accountId),
    startDate,
    endDate
  );

  res.json({
    success: true,
    data: statement,
  });
});