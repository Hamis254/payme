/**
 * =============================================================================
 * RECORD CONTROLLER: HTTP request handlers for financial ledger
 * =============================================================================
 * Handles all record operations: create, read, list, statement generation
 * @module controllers/record.controller
 */

import logger from '#config/logger.js';
import { deductTokens, refundTokens } from '#middleware/revenueGuard.middleware.js';
import * as recordService from '#services/record.service.js';
import * as statementService from '#services/statementService.js';
import {
  createRecordSchema,
  queryRecordsSchema,
  dashboardInsightsSchema,
  generateStatementSchema,
} from '#validations/record.validation.js';

/**
 * CREATE RECORD: All record types (sales, HP, credit, inventory, expense)
 * POST /api/records/create
 */
export async function createRecord(req, res, next) {
  const requestId = req.revenueGuard?.request_id;

  try {
    const { business_id } = req.params;
    const { id: user_id } = req.user;

    // Validate request
    const validationResult = createRecordSchema.safeParse({
      business_id: parseInt(business_id),
      ...req.body,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.errors,
        request_id: requestId,
      });
    }

    const recordData = {
      ...validationResult.data,
      user_id,
    };

    // Create record (with token deduction & Google Sheets sync)
    const record = await recordService.createRecord(recordData);

    // Deduct tokens after successful record creation
    try {
      await deductTokens(
        req.revenueGuard.wallet_id,
        req.revenueGuard.tokens_to_deduct,
        {
          record_id: record.id,
          business_id: parseInt(business_id),
          record_type: record.type,
          amount_kes: record.amount || 0,
        }
      );
    } catch (deductError) {
      logger.error('Token deduction failed for record', {
        record_id: record.id,
        error: deductError.message,
      });
      throw deductError;
    }

    logger.info('Record created via API', {
      record_id: record.id,
      business_id,
      user_id,
      type: record.type,
      request_id: requestId,
    });

    return res.status(201).json({
      success: true,
      message: 'Record created successfully',
      record,
      tokens_remaining: req.revenueGuard.balance_before - 1,
      request_id: requestId,
    });
  } catch (error) {
    logger.error('Record creation endpoint failed', {
      error: error.message,
      business_id: req.params.business_id,
      request_id: requestId,
    });

    // Refund tokens if deduction succeeded but something else failed
    if (req.revenueGuard?.wallet_id && error.message !== 'Insufficient tokens. Please purchase tokens to create records.') {
      try {
        await refundTokens(
          req.revenueGuard.wallet_id,
          req.revenueGuard.tokens_to_deduct,
          `Record creation error: ${error.message}`
        );
      } catch (refundError) {
        logger.error('Refund failed - manual intervention needed', {
          wallet_id: req.revenueGuard.wallet_id,
          error: refundError.message,
          request_id: requestId,
        });
      }
    }

    if (error.message === 'Insufficient tokens. Please purchase tokens to create records.') {
      return res.status(402).json({
        error: 'Insufficient tokens',
        message: error.message,
        request_id: requestId,
      });
    }

    if (error.message === 'Duplicate record detected (idempotent request)') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'This record already exists',
        request_id: requestId,
      });
    }

    next(error);
  }
}

/**
 * GET RECORDS: List all records for business with filters
 * GET /api/records/:business_id
 */
export async function getRecords(req, res, next) {
  try {
    const { business_id } = req.params;

    // Validate query parameters
    const validationResult = queryRecordsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: validationResult.error.errors,
      });
    }

    const filters = validationResult.data;

    // Fetch records
    const records = await recordService.getRecords(
      parseInt(business_id),
      filters
    );

    return res.status(200).json({
      success: true,
      count: records.length,
      records,
    });
  } catch (error) {
    logger.error('Get records endpoint failed', {
      error: error.message,
      business_id: req.params.business_id,
    });
    next(error);
  }
}

/**
 * GET RECORD BY ID: Fetch single record with items
 * GET /api/records/:business_id/:record_id
 */
export async function getRecordById(req, res, next) {
  try {
    const { business_id, record_id } = req.params;

    const record = await recordService.getRecordById(
      parseInt(business_id),
      parseInt(record_id)
    );

    return res.status(200).json({
      success: true,
      record,
    });
  } catch (error) {
    if (error.message === 'Record not found') {
      return res.status(404).json({
        error: 'Not found',
        message: 'Record not found',
      });
    }

    logger.error('Get record by ID endpoint failed', {
      error: error.message,
      business_id: req.params.business_id,
      record_id: req.params.record_id,
    });
    next(error);
  }
}

/**
 * GET TOTALS: Calculate financial summaries for dashboard
 * GET /api/records/:business_id/totals
 */
export async function getTotals(req, res, next) {
  try {
    const { business_id } = req.params;
    const { start_date, end_date } = req.query;

    const totals = await recordService.calculateTotals(
      parseInt(business_id),
      start_date ? new Date(start_date) : undefined,
      end_date ? new Date(end_date) : undefined
    );

    return res.status(200).json({
      success: true,
      totals,
    });
  } catch (error) {
    logger.error('Get totals endpoint failed', {
      error: error.message,
      business_id: req.params.business_id,
    });
    next(error);
  }
}

/**
 * GET DASHBOARD INSIGHTS: Trends and analytics
 * GET /api/records/:business_id/insights
 */
export async function getDashboardInsights(req, res, next) {
  try {
    const { business_id } = req.params;

    // Validate query
    const validationResult = dashboardInsightsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: validationResult.error.errors,
      });
    }

    const { period } = validationResult.data;

    const insights = await recordService.getDashboardInsights(
      parseInt(business_id),
      period
    );

    return res.status(200).json({
      success: true,
      period,
      insights,
    });
  } catch (error) {
    logger.error('Get insights endpoint failed', {
      error: error.message,
      business_id: req.params.business_id,
    });
    next(error);
  }
}

/**
 * GENERATE STATEMENT: Create bank-grade PDF statement
 * POST /api/records/:business_id/generate-statement
 */
export async function generateStatement(req, res, next) {
  try {
    const { business_id } = req.params;

    // Validate request
    const validationResult = generateStatementSchema.safeParse({
      business_id: parseInt(business_id),
      ...req.body,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.errors,
      });
    }

    const { start_date, end_date, format } = validationResult.data;

    if (format === 'pdf') {
      // Generate PDF
      const { pdfBuffer, vCode } =
        await statementService.generateBusinessStatement(
          parseInt(business_id),
          start_date,
          end_date
        );

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="statement_${business_id}_${vCode}.pdf"`
      );

      return res.send(pdfBuffer);
    }

    // CSV or JSON format
    const records = await recordService.getRecordsByDateRange(
      parseInt(business_id),
      start_date,
      end_date
    );

    const totals = await recordService.calculateTotals(
      parseInt(business_id),
      start_date,
      end_date
    );

    if (format === 'csv') {
      // Convert to CSV
      const csv = recordsToCSV(records, totals);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="statement_${business_id}.csv"`
      );
      return res.send(csv);
    }

    // JSON format (default)
    return res.status(200).json({
      success: true,
      business_id,
      period: {
        start_date,
        end_date: end_date || new Date(),
      },
      records,
      totals,
    });
  } catch (error) {
    logger.error('Generate statement endpoint failed', {
      error: error.message,
      business_id: req.params.business_id,
    });
    next(error);
  }
}

/**
 * HELPER: Convert records to CSV format
 */
function recordsToCSV(records, totals) {
  let csv = 'Date,Type,Category,Description,Amount,Payment Method,Notes\n';

  records.forEach(record => {
    csv += `"${record.transaction_date.toISOString().split('T')[0]}",`;
    csv += `"${record.type}",`;
    csv += `"${record.category}",`;
    csv += `"${record.description || ''}",`;
    csv += `${record.amount},`;
    csv += `"${record.payment_method || ''}",`;
    csv += `"${record.notes || ''}"\n`;
  });

  // Add totals
  csv += '\n,FINANCIAL SUMMARY,,,\n';
  csv += `Total Sales,,${totals.total_sales}\n`;
  csv += `Cash Sales,,${totals.cash_sales}\n`;
  csv += `M-Pesa Sales,,${totals.mpesa_sales}\n`;
  csv += `Higher Purchase,,${totals.higher_purchase}\n`;
  csv += `Credit Given,,${totals.credit_given}\n`;
  csv += `Credit Recovered,,${totals.credit_recovered}\n`;
  csv += `Expenses,,${totals.expenses}\n`;
  csv += `NET PROFIT,,${totals.net_profit}\n`;

  return csv;
}

export default {
  createRecord,
  getRecords,
  getRecordById,
  getTotals,
  getDashboardInsights,
  generateStatement,
};
