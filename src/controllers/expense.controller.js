import logger from '#config/logger.js';
import {
  recordExpense,
  getExpenseById,
  listExpenses,
  getExpenseSummary,
  getExpenseByCategory,
  getExpenseByPaymentMethod,
  getMonthlytExpenseTrend,
  getTopExpenses,
  getCategoryBreakdown,
  updateExpense,
  deleteExpense,
} from '#services/expense.service.js';
import {
  recordExpenseSchema,
  listExpensesSchema,
  updateExpenseSchema,
  deleteExpenseSchema,
  expenseAnalyticsSchema,
} from '#validations/expense.validation.js';
import { formatValidationError } from '#utils/format.js';

/**
 * POST /api/expenses/record
 * Record a new expense for a business
 */
export async function recordExpenseHandler(req, res, next) {
  try {
    const validationResult = recordExpenseSchema.safeParse({
      ...req.body,
      businessId: parseInt(req.params.businessId),
      createdBy: req.user.id,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const expense = await recordExpense(validationResult.data);

    logger.info(`Expense recorded by user ${req.user.id}`, {
      expenseId: expense.id,
      businessId: req.params.businessId,
    });

    return res.status(201).json({
      success: true,
      message: 'Expense recorded successfully',
      expense: {
        id: expense.id,
        category: expense.category,
        description: expense.description,
        amount: parseFloat(expense.amount),
        payment_method: expense.payment_method,
        expense_date: expense.expense_date,
        status: expense.status,
        created_at: expense.created_at,
      },
      request_id: req.id,
    });
  } catch (e) {
    logger.error('Error recording expense:', e);
    next(e);
  }
}

/**
 * GET /api/expenses/:businessId/:expenseId
 * Get a specific expense record
 */
export async function getExpenseHandler(req, res, next) {
  try {
    const { businessId, expenseId } = req.params;

    const expense = await getExpenseById(
      parseInt(businessId),
      parseInt(expenseId)
    );

    if (!expense) {
      return res.status(404).json({
        error: 'Expense not found',
      });
    }

    return res.status(200).json({
      success: true,
      expense: {
        ...expense,
        amount: parseFloat(expense.amount),
      },
    });
  } catch (e) {
    logger.error('Error fetching expense:', e);
    next(e);
  }
}

/**
 * GET /api/expenses/:businessId
 * List expenses with filters
 */
export async function listExpensesHandler(req, res, next) {
  try {
    const validationResult = listExpensesSchema.safeParse({
      ...req.query,
      businessId: parseInt(req.params.businessId),
      limit: req.query.limit ? parseInt(req.query.limit) : 50,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const expenses = await listExpenses(validationResult.data);

    return res.status(200).json({
      success: true,
      count: expenses.length,
      expenses: expenses.map(e => ({
        ...e,
        amount: parseFloat(e.amount),
      })),
    });
  } catch (e) {
    logger.error('Error listing expenses:', e);
    next(e);
  }
}

/**
 * GET /api/expenses/:businessId/summary
 * Get expense summary statistics
 */
export async function getExpenseSummaryHandler(req, res, next) {
  try {
    const { businessId } = req.params;
    const { startDate, endDate } = req.query;

    const summary = await getExpenseSummary(
      parseInt(businessId),
      startDate,
      endDate
    );

    return res.status(200).json({
      success: true,
      summary,
    });
  } catch (e) {
    logger.error('Error getting expense summary:', e);
    next(e);
  }
}

/**
 * GET /api/expenses/:businessId/analytics
 * Get expense analytics based on analysis type
 */
export async function getExpenseAnalyticsHandler(req, res, next) {
  try {
    const validationResult = expenseAnalyticsSchema.safeParse({
      businessId: parseInt(req.params.businessId),
      analysisType: req.query.analysisType,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? parseInt(req.query.limit) : 10,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { businessId, analysisType, startDate, endDate, limit } =
      validationResult.data;

    const analytics = {};

    switch (analysisType) {
      case 'summary':
        analytics.summary = await getExpenseSummary(businessId, startDate, endDate);
        break;

      case 'by_category':
        analytics.by_category = await getExpenseByCategory(
          businessId,
          startDate,
          endDate
        );
        break;

      case 'by_payment_method':
        analytics.by_payment_method = await getExpenseByPaymentMethod(
          businessId,
          startDate,
          endDate
        );
        break;

      case 'monthly_trend':
        analytics.monthly_trend = await getMonthlytExpenseTrend(businessId);
        break;

      case 'top_expenses':
        analytics.top_expenses = await getTopExpenses(businessId, limit);
        break;

      case 'category_breakdown':
        analytics.category_breakdown = await getCategoryBreakdown(businessId);
        break;

      default:
        return res.status(400).json({
          error: 'Invalid analysis type',
        });
    }

    logger.info(`Analytics generated for business ${businessId}`, {
      analysisType,
      businessId,
    });

    return res.status(200).json({
      success: true,
      analysisType,
      data: analytics,
    });
  } catch (e) {
    logger.error('Error generating analytics:', e);
    next(e);
  }
}

/**
 * PATCH /api/expenses/:businessId/:expenseId
 * Update an expense record
 */
export async function updateExpenseHandler(req, res, next) {
  try {
    const validationResult = updateExpenseSchema.safeParse({
      businessId: parseInt(req.params.businessId),
      expenseId: parseInt(req.params.expenseId),
      ...req.body,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { businessId, expenseId, ...updateData } = validationResult.data;

    const updated = await updateExpense(businessId, expenseId, updateData);

    if (!updated) {
      return res.status(404).json({
        error: 'Expense not found',
      });
    }

    logger.info(`Expense ${expenseId} updated by user ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      expense: {
        ...updated,
        amount: parseFloat(updated.amount),
      },
    });
  } catch (e) {
    logger.error('Error updating expense:', e);
    next(e);
  }
}

/**
 * DELETE /api/expenses/:businessId/:expenseId
 * Delete an expense record
 */
export async function deleteExpenseHandler(req, res, next) {
  try {
    const validationResult = deleteExpenseSchema.safeParse({
      businessId: parseInt(req.params.businessId),
      expenseId: parseInt(req.params.expenseId),
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { businessId, expenseId } = validationResult.data;

    const deleted = await deleteExpense(businessId, expenseId);

    if (!deleted) {
      return res.status(404).json({
        error: 'Expense not found',
      });
    }

    logger.info(`Expense ${expenseId} deleted by user ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: 'Expense deleted successfully',
      expense: {
        ...deleted,
        amount: parseFloat(deleted.amount),
      },
    });
  } catch (e) {
    logger.error('Error deleting expense:', e);
    next(e);
  }
}
