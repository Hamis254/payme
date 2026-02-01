import { db, sql } from '#config/database.js';
import { expenses } from '#models/expense.model.js';
import { and, eq, gte, lte, desc } from 'drizzle-orm';
import logger from '#config/logger.js';

/**
 * Record a new expense for a business
 * @param {Object} data - Expense data
 * @returns {Promise<Object>} Created expense record
 */
export async function recordExpense(data) {
  try {
    const {
      businessId,
      category,
      description,
      amount,
      paymentMethod,
      paymentReference,
      paymentPhone,
      expenseDate,
      paymentDate,
      note,
      receiptUrl,
      createdBy,
    } = data;

    const [expense] = await db
      .insert(expenses)
      .values({
        business_id: businessId,
        category,
        description,
        amount: amount.toString(),
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        payment_phone: paymentPhone,
        expense_date: new Date(expenseDate),
        payment_date: paymentDate ? new Date(paymentDate) : null,
        note,
        receipt_url: receiptUrl,
        created_by: createdBy,
        status: 'recorded',
      })
      .returning();

    logger.info(
      `Expense recorded: ${expense.id} for business ${businessId}`,
      {
        expenseId: expense.id,
        category,
        amount,
        createdBy,
      }
    );

    return expense;
  } catch (error) {
    logger.error('Error recording expense:', error);
    throw error;
  }
}

/**
 * Get a specific expense by ID
 * @param {number} businessId - Business ID
 * @param {number} expenseId - Expense ID
 * @returns {Promise<Object>} Expense record
 */
export async function getExpenseById(businessId, expenseId) {
  try {
    const [expense] = await db
      .select()
      .from(expenses)
      .where(
        and(eq(expenses.id, expenseId), eq(expenses.business_id, businessId))
      )
      .limit(1);

    return expense;
  } catch (error) {
    logger.error('Error fetching expense:', error);
    throw error;
  }
}

/**
 * List expenses with filtering
 * @param {Object} params - Query parameters
 * @returns {Promise<Array>} List of expenses
 */
export async function listExpenses(params) {
  try {
    const {
      businessId,
      category,
      paymentMethod,
      status,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = params;

    let query = db
      .select()
      .from(expenses)
      .where(eq(expenses.business_id, businessId));

    if (category) {
      query = query.where(eq(expenses.category, category));
    }

    if (paymentMethod) {
      query = query.where(eq(expenses.payment_method, paymentMethod));
    }

    if (status) {
      query = query.where(eq(expenses.status, status));
    }

    if (startDate) {
      query = query.where(gte(expenses.expense_date, new Date(startDate)));
    }

    if (endDate) {
      query = query.where(lte(expenses.expense_date, new Date(endDate)));
    }

    const results = await query
      .orderBy(desc(expenses.expense_date))
      .limit(limit)
      .offset(offset);

    return results;
  } catch (error) {
    logger.error('Error listing expenses:', error);
    throw error;
  }
}

/**
 * Get expense summary statistics
 * @param {number} businessId - Business ID
 * @param {string} startDate - Start date (ISO format)
 * @param {string} endDate - End date (ISO format)
 * @returns {Promise<Object>} Summary statistics
 */
export async function getExpenseSummary(businessId, startDate, endDate) {
  try {
    let whereClause = eq(expenses.business_id, businessId);

    if (startDate && endDate) {
      whereClause = and(
        whereClause,
        gte(expenses.expense_date, new Date(startDate)),
        lte(expenses.expense_date, new Date(endDate))
      );
    }

    const result = await db
      .select({
        total_count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount AS DECIMAL))`,
        average_amount: sql`AVG(CAST(amount AS DECIMAL))`,
        max_amount: sql`MAX(CAST(amount AS DECIMAL))`,
        min_amount: sql`MIN(CAST(amount AS DECIMAL))`,
      })
      .from(expenses)
      .where(whereClause);

    return {
      total_count: parseInt(result[0].total_count) || 0,
      total_amount: parseFloat(result[0].total_amount) || 0,
      average_amount: parseFloat(result[0].average_amount) || 0,
      max_amount: parseFloat(result[0].max_amount) || 0,
      min_amount: parseFloat(result[0].min_amount) || 0,
    };
  } catch (error) {
    logger.error('Error getting expense summary:', error);
    throw error;
  }
}

/**
 * Get expenses breakdown by category
 * @param {number} businessId - Business ID
 * @param {string} startDate - Start date (ISO format)
 * @param {string} endDate - End date (ISO format)
 * @returns {Promise<Array>} Category breakdown
 */
export async function getExpenseByCategory(businessId, startDate, endDate) {
  try {
    let whereClause = eq(expenses.business_id, businessId);

    if (startDate && endDate) {
      whereClause = and(
        whereClause,
        gte(expenses.expense_date, new Date(startDate)),
        lte(expenses.expense_date, new Date(endDate))
      );
    }

    const result = await db
      .select({
        category: expenses.category,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount AS DECIMAL))`,
        percentage: sql`ROUND(
          SUM(CAST(amount AS DECIMAL)) * 100.0 /
          (SELECT SUM(CAST(amount AS DECIMAL)) FROM expenses WHERE business_id = ${businessId}),
          2
        )`,
      })
      .from(expenses)
      .where(whereClause)
      .groupBy(expenses.category)
      .orderBy(desc(sql`SUM(CAST(amount AS DECIMAL))`));

    return result.map(row => ({
      category: row.category,
      count: parseInt(row.count),
      total_amount: parseFloat(row.total_amount),
      percentage: parseFloat(row.percentage) || 0,
    }));
  } catch (error) {
    logger.error('Error getting category breakdown:', error);
    throw error;
  }
}

/**
 * Get expenses by payment method
 * @param {number} businessId - Business ID
 * @param {string} startDate - Start date (ISO format)
 * @param {string} endDate - End date (ISO format)
 * @returns {Promise<Array>} Payment method breakdown
 */
export async function getExpenseByPaymentMethod(businessId, startDate, endDate) {
  try {
    let whereClause = eq(expenses.business_id, businessId);

    if (startDate && endDate) {
      whereClause = and(
        whereClause,
        gte(expenses.expense_date, new Date(startDate)),
        lte(expenses.expense_date, new Date(endDate))
      );
    }

    const result = await db
      .select({
        payment_method: expenses.payment_method,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount AS DECIMAL))`,
      })
      .from(expenses)
      .where(whereClause)
      .groupBy(expenses.payment_method)
      .orderBy(desc(sql`SUM(CAST(amount AS DECIMAL))`));

    return result.map(row => ({
      payment_method: row.payment_method,
      count: parseInt(row.count),
      total_amount: parseFloat(row.total_amount),
    }));
  } catch (error) {
    logger.error('Error getting payment method breakdown:', error);
    throw error;
  }
}

/**
 * Get monthly expense trend for pattern analysis
 * @param {number} businessId - Business ID
 * @returns {Promise<Array>} Monthly trend data
 */
export async function getMonthlytExpenseTrend(businessId) {
  try {
    const result = await db
      .select({
        month: sql`DATE_TRUNC('month', expense_date)`,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount AS DECIMAL))`,
        average_amount: sql`AVG(CAST(amount AS DECIMAL))`,
      })
      .from(expenses)
      .where(eq(expenses.business_id, businessId))
      .groupBy(sql`DATE_TRUNC('month', expense_date)`)
      .orderBy(desc(sql`DATE_TRUNC('month', expense_date)`));

    return result.map(row => ({
      month: row.month,
      count: parseInt(row.count),
      total_amount: parseFloat(row.total_amount),
      average_amount: parseFloat(row.average_amount),
    }));
  } catch (error) {
    logger.error('Error getting monthly trend:', error);
    throw error;
  }
}

/**
 * Get top expensive items
 * @param {number} businessId - Business ID
 * @param {number} limit - Number of top items to return
 * @returns {Promise<Array>} Top expenses
 */
export async function getTopExpenses(businessId, limit = 10) {
  try {
    const result = await db
      .select({
        id: expenses.id,
        category: expenses.category,
        description: expenses.description,
        amount: expenses.amount,
        payment_method: expenses.payment_method,
        expense_date: expenses.expense_date,
        status: expenses.status,
      })
      .from(expenses)
      .where(eq(expenses.business_id, businessId))
      .orderBy(desc(sql`CAST(amount AS DECIMAL)`))
      .limit(limit);

    return result.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
    }));
  } catch (error) {
    logger.error('Error getting top expenses:', error);
    throw error;
  }
}

/**
 * Get category breakdown with percentages
 * @param {number} businessId - Business ID
 * @returns {Promise<Array>} Category breakdown with distribution
 */
export async function getCategoryBreakdown(businessId) {
  try {
    const result = await db
      .select({
        category: expenses.category,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount AS DECIMAL))`,
        percentage: sql`ROUND(
          SUM(CAST(amount AS DECIMAL)) * 100.0 /
          (SELECT SUM(CAST(amount AS DECIMAL)) FROM expenses WHERE business_id = ${businessId}),
          2
        )`,
        average_amount: sql`AVG(CAST(amount AS DECIMAL))`,
      })
      .from(expenses)
      .where(eq(expenses.business_id, businessId))
      .groupBy(expenses.category)
      .orderBy(desc(sql`SUM(CAST(amount AS DECIMAL))`));

    return result.map(row => ({
      category: row.category,
      count: parseInt(row.count),
      total_amount: parseFloat(row.total_amount),
      percentage: parseFloat(row.percentage) || 0,
      average_amount: parseFloat(row.average_amount),
    }));
  } catch (error) {
    logger.error('Error getting category breakdown:', error);
    throw error;
  }
}

/**
 * Update an expense record
 * @param {number} businessId - Business ID
 * @param {number} expenseId - Expense ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object>} Updated expense
 */
export async function updateExpense(businessId, expenseId, data) {
  try {
    const updateData = {};

    if (data.category) updateData.category = data.category;
    if (data.description) updateData.description = data.description;
    if (data.amount) updateData.amount = data.amount.toString();
    if (data.paymentMethod) updateData.payment_method = data.paymentMethod;
    if (data.status) updateData.status = data.status;
    if (data.note !== undefined) updateData.note = data.note;

    updateData.updated_at = new Date();

    const [updated] = await db
      .update(expenses)
      .set(updateData)
      .where(and(eq(expenses.id, expenseId), eq(expenses.business_id, businessId)))
      .returning();

    logger.info(`Expense ${expenseId} updated for business ${businessId}`);

    return updated;
  } catch (error) {
    logger.error('Error updating expense:', error);
    throw error;
  }
}

/**
 * Delete an expense record
 * @param {number} businessId - Business ID
 * @param {number} expenseId - Expense ID
 * @returns {Promise<Object>} Deleted expense
 */
export async function deleteExpense(businessId, expenseId) {
  try {
    const [deleted] = await db
      .delete(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.business_id, businessId)))
      .returning();

    logger.info(`Expense ${expenseId} deleted for business ${businessId}`);

    return deleted;
  } catch (error) {
    logger.error('Error deleting expense:', error);
    throw error;
  }
}

/**
 * Calculate total expenses for profit calculation
 * @param {number} businessId - Business ID
 * @param {string} startDate - Start date (ISO format)
 * @param {string} endDate - End date (ISO format)
 * @returns {Promise<number>} Total expenses amount
 */
export async function getTotalExpenses(businessId, startDate, endDate) {
  try {
    let whereClause = and(
      eq(expenses.business_id, businessId),
      eq(expenses.status, 'paid')
    );

    if (startDate && endDate) {
      whereClause = and(
        whereClause,
        gte(expenses.expense_date, new Date(startDate)),
        lte(expenses.expense_date, new Date(endDate))
      );
    }

    const result = await db
      .select({
        total: sql`SUM(CAST(amount AS DECIMAL))`,
      })
      .from(expenses)
      .where(whereClause);

    return parseFloat(result[0].total) || 0;
  } catch (error) {
    logger.error('Error calculating total expenses:', error);
    throw error;
  }
}

/**
 * Get expense status distribution
 * @param {number} businessId - Business ID
 * @returns {Promise<Object>} Status distribution
 */
export async function getExpenseStatusDistribution(businessId) {
  try {
    const result = await db
      .select({
        status: expenses.status,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount AS DECIMAL))`,
      })
      .from(expenses)
      .where(eq(expenses.business_id, businessId))
      .groupBy(expenses.status);

    return result.reduce((acc, row) => {
      acc[row.status] = {
        count: parseInt(row.count),
        amount: parseFloat(row.total_amount),
      };
      return acc;
    }, {});
  } catch (error) {
    logger.error('Error getting status distribution:', error);
    throw error;
  }
}
