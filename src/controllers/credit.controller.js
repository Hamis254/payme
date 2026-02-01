// controllers/credit.controller.js
import { db } from '#config/database.js';
import { deductTokens, refundTokens } from '#middleware/revenueGuard.middleware.js';
import {
  creditAccounts,
  creditLedger,
  creditSales,
  creditPayments,
} from '#models/credit.model.js';
import { sales } from '#models/sales.model.js';
import { eq, and } from 'drizzle-orm';
import {
  createCreditAccountSchema,
  createCreditSaleSchema,
  recordCreditPaymentSchema,
} from '#validations/credit.validation.js';
import { formatValidationError } from '#utils/format.js';
import logger from '#config/logger.js';
import { catchAsync } from '#utils/catchAsync.js';
import * as creditService from '#services/credit.service.js';

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
    });

    // Deduct tokens after successful account creation
    try {
      await deductTokens(
        req.revenueGuard.wallet_id,
        req.revenueGuard.tokens_to_deduct,
        {
          account_id: accountId,
          business_id: businessId,
          customer_name: customerName,
          credit_limit: creditLimit || 0,
        }
      );
    } catch (deductError) {
      logger.error('Token deduction failed for credit account', {
        account_id: accountId,
        error: deductError.message,
      });
      throw deductError;
    }

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

    // Refund tokens if deduction succeeded but something else failed
    if (req.revenueGuard?.wallet_id) {
      try {
        await refundTokens(
          req.revenueGuard.wallet_id,
          req.revenueGuard.tokens_to_deduct,
          `Credit account creation error: ${err.message}`
        );
      } catch (refundError) {
        logger.error('Refund failed - manual intervention needed', {
          wallet_id: req.revenueGuard.wallet_id,
          error: refundError.message,
          request_id: requestId,
        });
      }
    }

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
    });

    // Deduct tokens after successful credit sale creation
    try {
      await deductTokens(
        req.revenueGuard.wallet_id,
        req.revenueGuard.tokens_to_deduct,
        {
          credit_sale_id: creditSaleId,
          sale_id: saleId,
          account_id: accountId,
          outstanding_amount: outstandingAmount,
        }
      );
    } catch (deductError) {
      logger.error('Token deduction failed for credit sale', {
        credit_sale_id: creditSaleId,
        error: deductError.message,
      });
      throw deductError;
    }

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

    // Refund tokens if deduction succeeded but something else failed
    if (req.revenueGuard?.wallet_id) {
      try {
        await refundTokens(
          req.revenueGuard.wallet_id,
          req.revenueGuard.tokens_to_deduct,
          `Credit sale creation error: ${err.message}`
        );
      } catch (refundError) {
        logger.error('Refund failed - manual intervention needed', {
          wallet_id: req.revenueGuard.wallet_id,
          error: refundError.message,
          request_id: requestId,
        });
      }
    }

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
  const { businessId } = req.user;
  const { status, search, page = 1, limit = 20 } = req.query;

  const accounts = await creditService.getCreditAccountsForBusiness(
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
  const { businessId } = req.user;
  const { accountId } = req.params;

  const account = await creditService.getCreditAccountById(
    accountId,
    businessId
  );

  res.json({
    success: true,
    data: account,
  });
});

// Update credit account
export const updateCreditAccount = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const updates = req.body;

  const account = await creditService.updateCreditAccount(
    accountId,
    businessId,
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
  const { businessId } = req.user;
  const { accountId } = req.params;

  await creditService.deactivateCreditAccount(accountId, businessId);

  res.json({
    success: true,
    message: 'Credit account deactivated successfully',
  });
});

// Get credit sales for account
export const getCreditSales = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

  const sales = await creditService.getCreditSalesForAccount(
    accountId,
    businessId,
    { status, startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
  );

  res.json({
    success: true,
    data: sales,
  });
});

// Get single credit sale with details
export const getCreditSale = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { saleId } = req.params;

  const sale = await creditService.getCreditSaleWithDetails(saleId, businessId);

  res.json({
    success: true,
    data: sale,
  });
});

// Get payments for account
export const getCreditPayments = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { startDate, endDate, page = 1, limit = 20 } = req.query;

  const payments = await creditService.getCreditPaymentsForAccount(
    accountId,
    businessId,
    { startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
  );

  res.json({
    success: true,
    data: payments,
  });
});

// Get ledger entries
export const getCreditLedger = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { startDate, endDate, page = 1, limit = 50 } = req.query;

  const ledger = await creditService.getCreditLedgerForAccount(
    accountId,
    businessId,
    { startDate, endDate, page: parseInt(page), limit: parseInt(limit) }
  );

  res.json({
    success: true,
    data: ledger,
  });
});

// Get credit summary for business
export const getCreditSummary = catchAsync(async (req, res) => {
  const { businessId } = req.user;

  const summary = await creditService.getCreditSummaryForBusiness(businessId);

  res.json({
    success: true,
    data: summary,
  });
});

// Get aging report
export const getAgingReport = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { asOfDate } = req.query;

  const report = await creditService.getAgingReport(businessId, asOfDate);

  res.json({
    success: true,
    data: report,
  });
});

// Get customer statement
export const getCustomerStatement = catchAsync(async (req, res) => {
  const { businessId } = req.user;
  const { accountId } = req.params;
  const { startDate, endDate } = req.query;

  const statement = await creditService.getCustomerStatement(
    accountId,
    businessId,
    startDate,
    endDate
  );

  res.json({
    success: true,
    data: statement,
  });
});
