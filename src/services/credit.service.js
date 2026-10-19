import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, desc, gte, lte, inArray, sql } from 'drizzle-orm';
import {
  creditAccounts,
  creditSales,
  creditPayments,
  creditLedger,
  getCreditSalesForBusiness as getCreditSalesForBusinessFromModel,
} from '#models/credit.model.js';
import { businesses } from '#models/setting.model.js';
import { sales, saleItems } from '#models/sales.model.js';
import { products } from '#models/stock.model.js';
import { startOfBusinessDay, endOfBusinessDay } from '#utils/businessDay.js';

const LOW_STOCK_FLOOR = 5; // flat default until a per-product threshold field exists

// ============ CREDIT RISK ASSESSMENT ============

/**
 * Runs BEFORE createCreditSale — two independent checks, either of which
 * can flag risk. Neither blocks the sale; processPayMe uses the result
 * to return a 409 "confirm to proceed" response instead of creating the
 * sale, unless override_stock_warning was already sent.
 *
 * 1. Business-wide: would this sale push total unpaid credit above
 *    credit_risk_threshold_percent of current inventory value?
 * 2. Per-item: does the cart include a product already at/below
 *    LOW_STOCK_FLOOR units, checked AFTER this sale's own deduction
 *    (cartItems here are createSale's post-deduction processedItems,
 *    so a fresh products query reflects the real remaining quantity).
 */
export const assessCreditStockRisk = async (
  businessId,
  cartItems = [],
  saleAmount,
  tx = db
) => {
  const [{ threshold }] = await tx
    .select({ threshold: businesses.credit_risk_threshold_percent })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  const [{ totalUnpaid }] = await tx
    .select({ totalUnpaid: sql`COALESCE(SUM(${creditAccounts.balance_due}), 0)` })
    .from(creditAccounts)
    .where(
      and(eq(creditAccounts.business_id, businessId), eq(creditAccounts.is_active, true))
    );

  const [{ inventoryValue }] = await tx
    .select({
      inventoryValue: sql`COALESCE(SUM(${products.current_quantity} * ${products.buying_price_per_unit}), 0)`,
    })
    .from(products)
    .where(and(eq(products.business_id, businessId), eq(products.is_active, 1)));

  const unpaidNow = Number(totalUnpaid) || 0;
  const invValue = Number(inventoryValue) || 0;
  const thresholdPercent = Number(threshold) || 70;
  const wouldBeUnpaid = unpaidNow + Number(saleAmount);
  const businessWideRisk = invValue > 0 && wouldBeUnpaid > invValue * (thresholdPercent / 100);

  const productIds = (cartItems || []).map(item => item.product_id);
  const currentStock = productIds.length
    ? await tx
        .select({
          id: products.id,
          name: products.name,
          current_quantity: products.current_quantity,
        })
        .from(products)
        .where(and(eq(products.business_id, businessId), inArray(products.id, productIds)))
    : [];

  const lowStockItems = currentStock.filter(
    product => Number(product.current_quantity) <= LOW_STOCK_FLOOR
  );

  return {
    atRisk: businessWideRisk || lowStockItems.length > 0,
    businessWideRisk,
    totalUnpaidCredit: unpaidNow,
    inventoryValue: invValue,
    thresholdPercent,
    lowStockItems: lowStockItems.map(product => ({
      product_id: product.id,
      name: product.name,
      remaining: Number(product.current_quantity),
    })),
  };
};

// ============ CREDIT ACCOUNTS ============

export const getCreditAccountById = async (userId, accountId) => {
  try {
    const [account] = await db
      .select({
        account: creditAccounts,
        business: businesses,
      })
      .from(creditAccounts)
      .innerJoin(businesses, eq(creditAccounts.business_id, businesses.id))
      .where(
        and(eq(creditAccounts.id, accountId), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!account) {
      throw new Error('Credit account not found or access denied');
    }

    return account;
  } catch (e) {
    logger.error('Error getting credit account', e);
    throw e;
  }
};

export const getCreditAccountsForBusiness = async (
  userId,
  businessId,
  options = {}
) => {
  try {
    // Verify business ownership
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) {
      throw new Error('Business not found or access denied');
    }

    // Build query
    const conditions = [eq(creditAccounts.business_id, businessId)];

    // Apply filters
    if (options.status === 'active') {
      conditions.push(eq(creditAccounts.is_active, true));
    } else if (options.status === 'inactive') {
      conditions.push(eq(creditAccounts.is_active, false));
    }

    let query = db
      .select()
      .from(creditAccounts)
      .where(and(...conditions))
      .orderBy(desc(creditAccounts.created_at));

    // Apply limit
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const accounts = await query;

    return { accounts, count: accounts.length };
  } catch (e) {
    logger.error('Error getting credit accounts for business', e);
    throw e;
  }
};

export const updateCreditAccount = async (userId, accountId, updates) => {
  try {
    // Verify ownership
    await getCreditAccountById(userId, accountId);

    const [updated] = await db
      .update(creditAccounts)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(eq(creditAccounts.id, accountId))
      .returning();

    logger.info(`Credit account ${accountId} updated`);
    return updated;
  } catch (e) {
    logger.error('Error updating credit account', e);
    throw e;
  }
};

export const deactivateCreditAccount = async (userId, accountId) => {
  try {
    const account = await getCreditAccountById(userId, accountId);

    // Check if there's outstanding balance
    if (Number(account.account.balance_due) > 0) {
      throw new Error('Cannot deactivate account with outstanding balance');
    }

    const [updated] = await db
      .update(creditAccounts)
      .set({
        is_active: false,
        updated_at: new Date(),
      })
      .where(eq(creditAccounts.id, accountId))
      .returning();

    logger.info(`Credit account ${accountId} deactivated`);
    return updated;
  } catch (e) {
    logger.error('Error deactivating credit account', e);
    throw e;
  }
};

// ============ CREDIT SALES ============

/**
 * Record a sale against a customer's credit account.
 *
 * `items` is accepted for signature compatibility with the caller, but not
 * persisted here — the sale's line items are already written to
 * `sale_items` by createSale() in sales.service.js, so storing them again
 * here would just duplicate that data.
 *
 * Accepts an optional `trx` — when processPayMe is running the whole sale
 * (stock deduction, sale row, this credit record, and the token-deduction
 * ledger entry) as one atomic unit, this needs to write into THAT SAME
 * transaction rather than opening its own. Opening a second, independent
 * transaction here was exactly what let a credit sale report failure back
 * to the client while the stock deduction from createSale() — already
 * committed under the caller's separate transaction — stayed in place.
 * Any other caller that doesn't supply a trx gets the old behavior:
 * this function opens and manages its own transaction as before.
 *
 * @param {number} userId - the business owner (for ownership verification)
 * @param {number} businessId
 * @param {number} accountId - credit_accounts.id
 * @param {number} saleId - sales.id, from the sale already created by createSale()
 * @param {number|string} totalAmount
 * @param {string|Date} dueDate
 * @param {Array} [items] - unused, accepted for call-signature compatibility
 * @param {object|null} [trx] - optional external transaction client
 * @returns {Promise<{ creditSale: object, account: object }>}
 */
export const createCreditSale = async (
  userId,
  businessId,
  accountId,
  saleId,
  totalAmount,
  dueDate,
  // eslint-disable-next-line no-unused-vars
  items,
  trx = null
) => {
  try {
    if (!accountId) {
      throw new Error('credit_account_id is required for credit sales');
    }
    if (!saleId) {
      throw new Error('saleId is required for credit sales');
    }
    if (!dueDate) {
      throw new Error('credit_due_date is required for credit sales');
    }

    // Verify the account exists, is owned by this user, and belongs to
    // the specific business making the sale (not just any business the
    // user owns).
    const accountData = await getCreditAccountById(userId, accountId);

    if (accountData.account.business_id !== businessId) {
      throw new Error('Credit account does not belong to this business');
    }

    if (!accountData.account.is_active) {
      throw new Error('Credit account is inactive');
    }

    const amount = Number(totalAmount);
    const currentBalance = Number(accountData.account.balance_due);
    const creditLimit = Number(accountData.account.credit_limit);
    const newBalance = currentBalance + amount;

    // credit_limit of 0 is treated as "no limit set" — same convention
    // used by getCreditSummaryForBusiness's utilization calculation above.
    if (creditLimit > 0 && newBalance > creditLimit) {
      throw new Error(
        `Credit limit exceeded: balance would be ${newBalance.toFixed(2)}, limit is ${creditLimit.toFixed(2)}`
      );
    }

    // Everything below must succeed together: the credit_sales row, the
    // account's running balance, and the audit ledger entry all have to
    // agree, or none of them should be written.
    const runInTransaction = async tx => {
      const [creditSale] = await tx
        .insert(creditSales)
        .values({
          sale_id: saleId,
          account_id: accountId,
          due_date: new Date(dueDate),
          outstanding_amount: String(amount),
          status: 'open',
        })
        .returning();

      const [updatedAccount] = await tx
        .update(creditAccounts)
        .set({
          balance_due: String(newBalance),
          updated_at: new Date(),
        })
        .where(eq(creditAccounts.id, accountId))
        .returning();

      await tx.insert(creditLedger).values({
        account_id: accountId,
        type: 'sale',
        amount: String(amount),
        balance_after: String(newBalance),
        reference: `Credit sale #${creditSale.id}`,
        created_by: userId,
      });

      return { creditSale, account: updatedAccount };
    };

    const result = trx
      ? await runInTransaction(trx)
      : await db.transaction(runInTransaction);

    logger.info('Credit sale recorded', {
      accountId,
      saleId,
      amount,
      newBalance,
      creditSaleId: result.creditSale.id,
    });

    return result;
  } catch (e) {
    logger.error('Error creating credit sale', e);
    throw e;
  }
};

export const getCreditSalesForBusiness = async (userId, businessId) => {
  const result = await getCreditSalesForBusinessFromModel(userId, businessId);
  const creditSalesList = result.credit_sales || [];

  const summary = {
    total_sales: creditSalesList.length,
    total_outstanding: Number(
      creditSalesList
        .reduce((sum, item) => sum + Number(item.outstanding_amount || 0), 0)
        .toFixed(2)
    ),
    open_count: creditSalesList.filter(item => item.status === 'open').length,
    partial_count: creditSalesList.filter(item => item.status === 'partial').length,
    paid_count: creditSalesList.filter(item => item.status === 'paid').length,
    overdue_count: creditSalesList.filter(item => {
      if (item.status !== 'open') return false;
      const dueDate = item.due_date ? new Date(item.due_date) : null;
      return dueDate && dueDate < new Date();
    }).length,
  };

  return {
    ...result,
    summary,
  };
};

export const getCreditSalesForAccount = async (
  userId,
  accountId,
  options = {}
) => {
  try {
    // Verify ownership
    await getCreditAccountById(userId, accountId);

    // Build conditions
    const conditions = [eq(creditSales.account_id, accountId)];

    // Apply filters
    if (options.status) {
      conditions.push(eq(creditSales.status, options.status));
    }

    // Check for overdue sales
    if (options.overdue) {
      conditions.push(
        lte(creditSales.due_date, new Date()),
        eq(creditSales.status, 'open')
      );
    }

    let query = db
      .select({
        creditSale: creditSales,
        sale: sales,
      })
      .from(creditSales)
      .innerJoin(sales, eq(creditSales.sale_id, sales.id))
      .where(and(...conditions))
      .orderBy(desc(creditSales.created_at));

    // Apply limit
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const creditSalesData = await query;

    return { creditSales: creditSalesData, count: creditSalesData.length };
  } catch (e) {
    logger.error('Error getting credit sales for account', e);
    throw e;
  }
};

export const getCreditSaleWithDetails = async (userId, creditSaleId) => {
  try {
    const [creditSaleData] = await db
      .select({
        creditSale: creditSales,
        account: creditAccounts,
        sale: sales,
        business: businesses,
      })
      .from(creditSales)
      .innerJoin(creditAccounts, eq(creditSales.account_id, creditAccounts.id))
      .innerJoin(sales, eq(creditSales.sale_id, sales.id))
      .innerJoin(businesses, eq(creditAccounts.business_id, businesses.id))
      .where(
        and(eq(creditSales.id, creditSaleId), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!creditSaleData) {
      throw new Error('Credit sale not found or access denied');
    }

    // Get sale items
    const items = await db
      .select({
        item: saleItems,
        product: products,
      })
      .from(saleItems)
      .leftJoin(products, eq(saleItems.product_id, products.id))
      .where(eq(saleItems.sale_id, creditSaleData.sale.id));

    return {
      ...creditSaleData,
      items,
    };
  } catch (e) {
    logger.error('Error getting credit sale details', e);
    throw e;
  }
};

// ============ CREDIT PAYMENTS ============

export const getCreditPaymentsForAccount = async (
  userId,
  accountId,
  options = {}
) => {
  try {
    // Verify ownership
    await getCreditAccountById(userId, accountId);

    let query = db
      .select()
      .from(creditPayments)
      .where(eq(creditPayments.account_id, accountId))
      .orderBy(desc(creditPayments.created_at));

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const payments = await query;

    return { payments, count: payments.length };
  } catch (e) {
    logger.error('Error getting credit payments for account', e);
    throw e;
  }
};

// ============ CREDIT LEDGER ============

export const getCreditLedgerForAccount = async (
  userId,
  accountId,
  options = {}
) => {
  try {
    // Verify ownership
    await getCreditAccountById(userId, accountId);

    const conditions = [eq(creditLedger.account_id, accountId)];

    if (options.type) {
      conditions.push(eq(creditLedger.type, options.type));
    }

    let query = db
      .select()
      .from(creditLedger)
      .where(and(...conditions))
      .orderBy(desc(creditLedger.created_at));

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const ledgerEntries = await query;

    return { ledger: ledgerEntries, count: ledgerEntries.length };
  } catch (e) {
    logger.error('Error getting credit ledger for account', e);
    throw e;
  }
};

// ============ REPORTS & ANALYTICS ============

export const getCreditSummaryForBusiness = async (userId, businessId) => {
  try {
    // Verify business ownership
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) {
      throw new Error('Business not found or access denied');
    }

    // Get all credit accounts for the business
    const accounts = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.business_id, businessId));

    // Calculate totals
    const totalAccounts = accounts.length;
    const activeAccounts = accounts.filter(a => a.is_active).length;
    const totalOutstanding = accounts.reduce(
      (sum, a) => sum + Number(a.balance_due),
      0
    );
    const totalCreditLimit = accounts.reduce(
      (sum, a) => sum + Number(a.credit_limit),
      0
    );

    // Get overdue sales
    const overdueSales = await db
      .select()
      .from(creditSales)
      .innerJoin(creditAccounts, eq(creditSales.account_id, creditAccounts.id))
      .where(
        and(
          eq(creditAccounts.business_id, businessId),
          lte(creditSales.due_date, new Date()),
          eq(creditSales.status, 'open')
        )
      );

    const totalOverdue = overdueSales.reduce(
      (sum, s) => sum + Number(s.credit_sales.outstanding_amount),
      0
    );

    return {
      summary: {
        totalAccounts,
        activeAccounts,
        inactiveAccounts: totalAccounts - activeAccounts,
        totalOutstanding: Number(totalOutstanding.toFixed(2)),
        totalCreditLimit: Number(totalCreditLimit.toFixed(2)),
        creditUtilization:
          totalCreditLimit > 0
            ? Number(((totalOutstanding / totalCreditLimit) * 100).toFixed(2))
            : 0,
        totalOverdue: Number(totalOverdue.toFixed(2)),
        overdueCount: overdueSales.length,
      },
    };
  } catch (e) {
    logger.error('Error getting credit summary for business', e);
    throw e;
  }
};

export const getAgingReport = async (userId, businessId) => {
  try {
    // Verify business ownership
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) {
      throw new Error('Business not found or access denied');
    }

    // Get all open credit sales with account info
    const openSales = await db
      .select({
        creditSale: creditSales,
        account: creditAccounts,
      })
      .from(creditSales)
      .innerJoin(creditAccounts, eq(creditSales.account_id, creditAccounts.id))
      .where(
        and(
          eq(creditAccounts.business_id, businessId),
          eq(creditSales.status, 'open')
        )
      );

    const now = new Date();
    const aging = {
      current: [],
      days_1_30: [],
      days_31_60: [],
      days_61_90: [],
      days_over_90: [],
    };

    openSales.forEach(item => {
      const dueDate = new Date(item.creditSale.due_date);
      const daysOverdue = Math.floor(
        (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const saleInfo = {
        creditSaleId: item.creditSale.id,
        saleId: item.creditSale.sale_id,
        accountId: item.account.id,
        customerName: item.account.customer_name,
        amount: Number(item.creditSale.outstanding_amount),
        dueDate: item.creditSale.due_date,
        daysOverdue,
      };

      if (daysOverdue < 0) {
        aging.current.push(saleInfo);
      } else if (daysOverdue <= 30) {
        aging.days_1_30.push(saleInfo);
      } else if (daysOverdue <= 60) {
        aging.days_31_60.push(saleInfo);
      } else if (daysOverdue <= 90) {
        aging.days_61_90.push(saleInfo);
      } else {
        aging.days_over_90.push(saleInfo);
      }
    });

    return {
      aging,
      summary: {
        current: {
          count: aging.current.length,
          total: aging.current.reduce((sum, s) => sum + s.amount, 0),
        },
        days_1_30: {
          count: aging.days_1_30.length,
          total: aging.days_1_30.reduce((sum, s) => sum + s.amount, 0),
        },
        days_31_60: {
          count: aging.days_31_60.length,
          total: aging.days_31_60.reduce((sum, s) => sum + s.amount, 0),
        },
        days_61_90: {
          count: aging.days_61_90.length,
          total: aging.days_61_90.reduce((sum, s) => sum + s.amount, 0),
        },
        days_over_90: {
          count: aging.days_over_90.length,
          total: aging.days_over_90.reduce((sum, s) => sum + s.amount, 0),
        },
      },
    };
  } catch (e) {
    logger.error('Error generating aging report', e);
    throw e;
  }
};

export const getCustomerStatement = async (
  userId,
  accountId,
  startDate,
  endDate
) => {
  try {
    // Verify ownership and get account
    const accountData = await getCreditAccountById(userId, accountId);

    // Build date conditions
    const conditions = [eq(creditLedger.account_id, accountId)];

    if (startDate) {
      conditions.push(gte(creditLedger.created_at, startOfBusinessDay(startDate)));
    }

    if (endDate) {
      conditions.push(lte(creditLedger.created_at, endOfBusinessDay(endDate)));
    }

    const ledgerEntries = await db
      .select()
      .from(creditLedger)
      .where(and(...conditions))
      .orderBy(creditLedger.created_at);

    // Calculate running balance
    const statement = ledgerEntries.map(entry => ({
      date: entry.created_at,
      type: entry.type,
      reference: entry.reference,
      note: entry.note,
      debit: Number(entry.amount) > 0 ? Number(entry.amount) : null,
      credit: Number(entry.amount) < 0 ? Math.abs(Number(entry.amount)) : null,
      balance: Number(entry.balance_after),
    }));

    return {
      account: accountData.account,
      business: accountData.business,
      statement,
      period: {
        from: startDate || ledgerEntries[0]?.created_at || null,
        to: endDate || new Date(),
      },
      summary: {
        openingBalance:
          ledgerEntries[0]?.balance_after || accountData.account.balance_due,
        closingBalance: Number(accountData.account.balance_due),
        totalDebits: statement
          .filter(s => s.debit)
          .reduce((sum, s) => sum + (s.debit || 0), 0),
        totalCredits: statement
          .filter(s => s.credit)
          .reduce((sum, s) => sum + (s.credit || 0), 0),
      },
    };
  } catch (e) {
    logger.error('Error generating customer statement', e);
    throw e;
  }
};