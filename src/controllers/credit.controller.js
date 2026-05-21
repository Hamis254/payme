// controllers/credit.controller.js
import { db } from '#config/database.js';
// Token deduction centralized in `createRecord` service
import {
  creditAccounts,
  creditLedger,
  creditSales,
  creditPayments,
} from '#models/credit.model.js';
import { sales } from '#models/sales.model.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';
import {
  createCreditAccountSchema,
  createCreditSaleSchema,
  recordCreditPaymentSchema,
} from '#validations/credit.validation.js';
import { formatValidationError } from '#utils/format.js';
import logger from '#config/logger.js';
import { AuthorizationError } from '#middleware/errorHandler.middleware.js';
import { catchAsync } from '#utils/catchAsync.js';
import * as creditService from '#services/credit.service.js';
import * as recordService from '#services/record.service.js';

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

    let accountId;
    await db.transaction(async tx => {
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

    const { saleId, accountId, dueDate, outstandingAmount } = parsed.data;
    let creditSaleId;

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

      // Check if adding this sale would exceed credit limit
      const newBalance =
        Number(account.balance_due) + Number(outstandingAmount);
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
          business_id: parsed.data.businessId,
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

      if (Number(amount) > Number(account.balance_due)) {
        throw new Error('Payment amount exceeds balance due');
      }

      // Record payment
      const [payment] = await tx
        .insert(creditPayments)
        .values({
          account_id: accountId,
          sale_id: saleId || null,
          amount: String(amount),
          payment_method: paymentMethod,
          mpesa_transaction_id: mpesaTransactionId || null,
          reference: reference || null,
          created_at: new Date(),
        })
        .returning();

      // Update account balance
      const newBalance = Number(account.balance_due) - Number(amount);
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

      logger.info(
        `Credit payment recorded: ${amount} for account #${accountId}`
      );
      res.status(201).json({
        message: 'Payment recorded successfully',
        payment,
        newBalance,
      });
    });
  } catch (err) {
    logger.error('Error recording credit payment', err);
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
  const businessId = Number(req.query.businessId);
  if (Number.isNaN(businessId)) {
    return res
      .status(400)
      .json({ error: 'businessId query parameter is required' });
  }
  const { status, search, page = 1, limit = 20 } = req.query;
  await assertBusinessOwnership(req.user.id, businessId);

  const accounts = await creditService.getCreditAccountsForBusiness(
    req.user.id,
    businessId,
    { status, search, page: parseInt(page), limit: parseInt(limit) }
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
    { status, startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
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
    { startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
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
    { startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
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
