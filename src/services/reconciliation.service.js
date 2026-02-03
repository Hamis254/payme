// reconciliation.service.js
import { db, sql } from '#config/database.js';
import { sales } from '#models/sales.model.js';
import { payments } from '#models/payments.model.js';
import { expenses } from '#models/expense.model.js';
import { walletTransactions } from '#models/myWallet.model.js';
import {
  cashReconciliations,
  mpesaReconciliations,
  reconciliationConfig,
} from '#models/reconciliation.model.js';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import logger from '#config/logger.js';

/**
 * Get or create reconciliation config for a business
 */
export const getReconciliationConfig = async (businessId) => {
  try {
    let [config] = await db
      .select()
      .from(reconciliationConfig)
      .where(eq(reconciliationConfig.business_id, businessId))
      .limit(1);

    if (!config) {
      [config] = await db
        .insert(reconciliationConfig)
        .values({
          business_id: businessId,
          cash_variance_threshold: '2.00',
          mpesa_variance_threshold: '0.50',
          daily_reconciliation_required: 1,
          auto_flag_enabled: 1,
          supervisor_approval_required: 1,
        })
        .returning();
      logger.info(`Reconciliation config created for business ${businessId}`);
    }

    return config;
  } catch (e) {
    logger.error('Error getting reconciliation config', e);
    throw e;
  }
};

/**
 * Update reconciliation config
 */
export const updateReconciliationConfig = async (businessId, updates) => {
  try {
    const config = await getReconciliationConfig(businessId);

    const [updated] = await db
      .update(reconciliationConfig)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(eq(reconciliationConfig.id, config.id))
      .returning();

    logger.info(`Reconciliation config updated for business ${businessId}`);
    return updated;
  } catch (e) {
    logger.error('Error updating reconciliation config', e);
    throw e;
  }
};

/**
 * Calculate system cash for a given date range
 * Includes cash sales and cash income, minus cash expenses
 */
export const calculateSystemCash = async (businessId, startDate, endDate) => {
  try {
    // Get cash sales total
    const cashSales = await db
      .select({
        total: sql`COALESCE(SUM(CAST(${sales.total_amount} AS DECIMAL)), 0)`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.payment_mode, 'cash'),
          eq(sales.status, 'completed'),
          gte(sales.created_at, new Date(startDate)),
          lte(sales.created_at, new Date(endDate))
        )
      );

    // Get cash payments received
    const cashPayments = await db
      .select({
        total: sql`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL)), 0)`,
      })
      .from(payments)
      .innerJoin(sales, eq(payments.sale_id, sales.id))
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(payments.status, 'success'),
          gte(payments.created_at, new Date(startDate)),
          lte(payments.created_at, new Date(endDate))
        )
      );

    // Get cash expenses
    const cashExpenses = await db
      .select({
        total: sql`COALESCE(SUM(CAST(${expenses.amount} AS DECIMAL)), 0)`,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.business_id, businessId),
          eq(expenses.payment_method, 'cash'),
          gte(expenses.expense_date, new Date(startDate)),
          lte(expenses.expense_date, new Date(endDate))
        )
      );

    // Get token charges (wallet deductions)
    const tokenCharges = await db
      .select({
        total: sql`COALESCE(SUM(ABS(${walletTransactions.change_tokens} * 2)), 0)`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.business_id, businessId),
          eq(walletTransactions.type, 'charge'),
          gte(walletTransactions.created_at, new Date(startDate)),
          lte(walletTransactions.created_at, new Date(endDate))
        )
      );

    const salesTotal = Number(cashSales[0]?.total || 0);
    const paymentsTotal = Number(cashPayments[0]?.total || 0);
    const expensesTotal = Number(cashExpenses[0]?.total || 0);
    const tokenChargesTotal = Number(tokenCharges[0]?.total || 0);

    // System cash = sales + payments - expenses - token charges
    const systemCash = salesTotal + paymentsTotal - expensesTotal - tokenChargesTotal;

    return {
      sales: salesTotal,
      payments: paymentsTotal,
      expenses: expensesTotal,
      tokenCharges: tokenChargesTotal,
      systemCash,
    };
  } catch (e) {
    logger.error('Error calculating system cash', e);
    throw e;
  }
};

/**
 * Create cash reconciliation record
 */
export const createCashReconciliation = async (businessId, userId, data) => {
  try {
    const config = await getReconciliationConfig(businessId);
    
    // Calculate system cash for the date
    const systemCashData = await calculateSystemCash(
      businessId,
      data.reconciliation_date,
      new Date(new Date(data.reconciliation_date).getTime() + 24 * 60 * 60 * 1000)
    );

    const countedCash = Number(data.counted_cash);
    const systemCash = systemCashData.systemCash;
    const variance = countedCash - systemCash;
    const variancePercent = systemCash !== 0 ? (variance / systemCash) * 100 : 0;

    // Determine variance status
    let varianceStatus = 'approved';
    const threshold = Number(config.cash_variance_threshold);
    if (Math.abs(variancePercent) > threshold) {
      varianceStatus = config.auto_flag_enabled ? 'flagged' : 'investigated';
    }

    const [reconciliation] = await db
      .insert(cashReconciliations)
      .values({
        business_id: businessId,
        reconciliation_date: new Date(data.reconciliation_date),
        counted_cash: String(countedCash),
        system_cash: String(systemCash),
        variance: String(variance.toFixed(2)),
        variance_percent: String(variancePercent.toFixed(2)),
        variance_status: varianceStatus,
        variance_note: data.note || null,
        performed_by: userId,
        metadata: data.metadata || null,
      })
      .returning();

    logger.info(`Cash reconciliation created for business ${businessId}`, {
      reconciliationId: reconciliation.id,
      variance: variance.toFixed(2),
      variancePercent: variancePercent.toFixed(2),
      status: varianceStatus,
    });

    return {
      ...reconciliation,
      systemCashBreakdown: systemCashData,
    };
  } catch (e) {
    logger.error('Error creating cash reconciliation', e);
    throw e;
  }
};

/**
 * Get cash reconciliations for a business
 */
export const getCashReconciliations = async (businessId, options = {}) => {
  try {
    const { limit = 30, offset = 0, startDate, endDate } = options;

    let query = db
      .select({
        reconciliation: cashReconciliations,
      })
      .from(cashReconciliations)
      .where(eq(cashReconciliations.business_id, businessId));

    if (startDate) {
      query = query.where(gte(cashReconciliations.reconciliation_date, new Date(startDate)));
    }
    if (endDate) {
      query = query.where(lte(cashReconciliations.reconciliation_date, new Date(endDate)));
    }

    const results = await query
      .orderBy(desc(cashReconciliations.reconciliation_date))
      .limit(limit)
      .offset(offset);

    return results.map(r => r.reconciliation);
  } catch (e) {
    logger.error('Error getting cash reconciliations', e);
    throw e;
  }
};

/**
 * Approve a cash reconciliation
 */
export const approveCashReconciliation = async (businessId, reconciliationId, approvedBy) => {
  try {
    const [reconciliation] = await db
      .select()
      .from(cashReconciliations)
      .where(
        and(
          eq(cashReconciliations.id, reconciliationId),
          eq(cashReconciliations.business_id, businessId)
        )
      )
      .limit(1);

    if (!reconciliation) {
      throw new Error('Reconciliation not found');
    }

    if (reconciliation.variance_status === 'approved') {
      throw new Error('Reconciliation already approved');
    }

    const [updated] = await db
      .update(cashReconciliations)
      .set({
        variance_status: 'approved',
        approved_by: approvedBy,
        approved_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(cashReconciliations.id, reconciliationId))
      .returning();

    logger.info(`Cash reconciliation ${reconciliationId} approved by user ${approvedBy}`);
    return updated;
  } catch (e) {
    logger.error('Error approving cash reconciliation', e);
    throw e;
  }
};

/**
 * Flag a cash reconciliation for investigation
 */
export const flagCashReconciliation = async (businessId, reconciliationId, note) => {
  try {
    const [updated] = await db
      .update(cashReconciliations)
      .set({
        variance_status: 'investigated',
        variance_note: note,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(cashReconciliations.id, reconciliationId),
          eq(cashReconciliations.business_id, businessId)
        )
      )
      .returning();

    logger.info(`Cash reconciliation ${reconciliationId} flagged for investigation`);
    return updated;
  } catch (e) {
    logger.error('Error flagging cash reconciliation', e);
    throw e;
  }
};

/**
 * Calculate M-Pesa transactions for a period
 */
export const calculateMpesaTransactions = async (businessId, startDate, endDate) => {
  try {
    // Get M-Pesa payments from sales
    const mpesaSales = await db
      .select({
        count: sql`COUNT(*)`,
        total: sql`COALESCE(SUM(CAST(${sales.total_amount} AS DECIMAL)), 0)`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(sales.payment_mode, 'mpesa'),
          eq(sales.status, 'completed'),
          gte(sales.created_at, new Date(startDate)),
          lte(sales.created_at, new Date(endDate))
        )
      );

    // Get M-Pesa payments
    const mpesaPayments = await db
      .select({
        count: sql`COUNT(*)`,
        total: sql`COALESCE(SUM(CAST(${payments.amount} AS DECIMAL)), 0)`,
      })
      .from(payments)
      .innerJoin(sales, eq(payments.sale_id, sales.id))
      .where(
        and(
          eq(sales.business_id, businessId),
          eq(payments.status, 'success'),
          gte(payments.created_at, new Date(startDate)),
          lte(payments.created_at, new Date(endDate))
        )
      );

    const salesCount = Number(mpesaSales[0]?.count || 0);
    const salesTotal = Number(mpesaSales[0]?.total || 0);
    const paymentsCount = Number(mpesaPayments[0]?.count || 0);
    const paymentsTotal = Number(mpesaPayments[0]?.total || 0);

    return {
      salesCount,
      salesTotal,
      paymentsCount,
      paymentsTotal,
      totalTransactions: salesCount + paymentsCount,
      totalAmount: salesTotal + paymentsTotal,
    };
  } catch (e) {
    logger.error('Error calculating M-Pesa transactions', e);
    throw e;
  }
};

/**
 * Create M-Pesa reconciliation record
 */
export const createMpesaReconciliation = async (businessId, userId, data) => {
  try {
    const config = await getReconciliationConfig(businessId);

    // Calculate system M-Pesa
    const systemData = await calculateMpesaTransactions(
      businessId,
      data.period_start,
      data.period_end
    );

    const bankAmount = Number(data.bank_amount);
    const bankTransactions = Number(data.bank_transactions);
    const systemAmount = systemData.totalAmount;
    const systemTxCount = systemData.totalTransactions;

    const varianceAmount = bankAmount - systemAmount;
    const varianceTransactions = bankTransactions - systemTxCount;

    // Determine status
    let status = 'matched';
    const threshold = Number(config.mpesa_variance_threshold);
    const variancePercent = systemAmount !== 0 ? (varianceAmount / systemAmount) * 100 : 0;

    if (Math.abs(variancePercent) > threshold || varianceTransactions !== 0) {
      status = 'investigation_needed';
    }

    const [reconciliation] = await db
      .insert(mpesaReconciliations)
      .values({
        business_id: businessId,
        period_start: new Date(data.period_start),
        period_end: new Date(data.period_end),
        system_transactions: systemTxCount,
        system_amount: String(systemAmount),
        bank_transactions: bankTransactions,
        bank_amount: String(bankAmount),
        variance_transactions: varianceTransactions,
        variance_amount: String(varianceAmount.toFixed(2)),
        status,
        investigation_notes: data.investigation_notes || null,
        missing_transactions: data.missing_transactions || null,
        extra_transactions: data.extra_transactions || null,
        performed_by: userId,
      })
      .returning();

    logger.info(`M-Pesa reconciliation created for business ${businessId}`, {
      reconciliationId: reconciliation.id,
      varianceAmount: varianceAmount.toFixed(2),
      status,
    });

    return {
      ...reconciliation,
      systemBreakdown: systemData,
    };
  } catch (e) {
    logger.error('Error creating M-Pesa reconciliation', e);
    throw e;
  }
};

/**
 * Get M-Pesa reconciliations
 */
export const getMpesaReconciliations = async (businessId, options = {}) => {
  try {
    const { limit = 30, offset = 0 } = options;

    const results = await db
      .select()
      .from(mpesaReconciliations)
      .where(eq(mpesaReconciliations.business_id, businessId))
      .orderBy(desc(mpesaReconciliations.period_start))
      .limit(limit)
      .offset(offset);

    return results;
  } catch (e) {
    logger.error('Error getting M-Pesa reconciliations', e);
    throw e;
  }
};

/**
 * Get reconciliation summary for dashboard
 */
export const getReconciliationSummary = async (businessId) => {
  try {
    // Get recent cash reconciliations
    const recentCash = await db
      .select({
        count: sql`COUNT(*)`,
        approved: sql`SUM(CASE WHEN ${cashReconciliations.variance_status} = 'approved' THEN 1 ELSE 0 END)`,
        flagged: sql`SUM(CASE WHEN ${cashReconciliations.variance_status} IN ('flagged', 'investigated') THEN 1 ELSE 0 END)`,
        avgVariance: sql`AVG(ABS(CAST(${cashReconciliations.variance} AS DECIMAL)))`,
      })
      .from(cashReconciliations)
      .where(eq(cashReconciliations.business_id, businessId));

    // Get recent M-Pesa reconciliations
    const recentMpesa = await db
      .select({
        count: sql`COUNT(*)`,
        matched: sql`SUM(CASE WHEN ${mpesaReconciliations.status} = 'matched' THEN 1 ELSE 0 END)`,
        investigation: sql`SUM(CASE WHEN ${mpesaReconciliations.status} = 'investigation_needed' THEN 1 ELSE 0 END)`,
      })
      .from(mpesaReconciliations)
      .where(eq(mpesaReconciliations.business_id, businessId));

    return {
      cash: {
        totalReconciliations: Number(recentCash[0]?.count || 0),
        approved: Number(recentCash[0]?.approved || 0),
        flagged: Number(recentCash[0]?.flagged || 0),
        avgVariance: Number(recentCash[0]?.avgVariance || 0),
      },
      mpesa: {
        totalReconciliations: Number(recentMpesa[0]?.count || 0),
        matched: Number(recentMpesa[0]?.matched || 0),
        investigationNeeded: Number(recentMpesa[0]?.investigation || 0),
      },
    };
  } catch (e) {
    logger.error('Error getting reconciliation summary', e);
    throw e;
  }
};
