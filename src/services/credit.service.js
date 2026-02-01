import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import {
  creditAccounts,
  creditSales,
  creditPayments,
  creditLedger,
} from '#models/credit.model.js';
import { businesses } from '#models/setting.model.js';
import { sales, saleItems } from '#models/sales.model.js';
import { products } from '#models/stock.model.js';

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
      conditions.push(gte(creditLedger.created_at, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(creditLedger.created_at, new Date(endDate)));
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
