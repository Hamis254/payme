/**
 * =============================================================================
 * RECORD CONTROLLER: HTTP request handlers for financial ledger
 * =============================================================================
 * Handles all record operations: create, read, list, statement generation
 * @module controllers/record.controller
 */

import logger from '#config/logger.js';
// Token deduction is handled inside `createRecord` transaction — no manual calls
import * as recordService from '#services/record.service.js';
import * as statementService from '#services/statementService.js';
import { getStatementFinancials } from '#services/sales.service.js';
import {
  startOfBusinessDay,
  endOfBusinessDay,
  businessDayKey,
  resolveStatementRange,
} from '#utils/businessDay.js';
import {
  createRecordSchema,
  queryRecordsSchema,
  dashboardInsightsSchema,
  generateStatementSchema,
  statementRangeSchema,
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

    const validationResult = createRecordSchema.safeParse({
      ...req.body,
      business_id: parseInt(business_id),
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.issues,
        request_id: requestId,
      });
    }

    const recordData = {
      ...validationResult.data,
      user_id,
    };

    const record = await recordService.createRecord(recordData);

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

    if (
      error.message ===
      'Insufficient tokens. Please purchase tokens to create records.'
    ) {
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
 *
 * This is also what the Statement page's on-screen preview table calls
 * (filtered to start_date/end_date) — the same zebra-striped table used
 * throughout Records, just scoped to the statement's date range. No
 * separate "statement preview" endpoint needed.
 */
export async function getRecords(req, res, next) {
  try {
    const { business_id } = req.params;

    const validationResult = queryRecordsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: validationResult.error.issues,
      });
    }

    const filters = validationResult.data;

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
      start_date ? startOfBusinessDay(start_date) : undefined,
      end_date ? endOfBusinessDay(end_date) : undefined
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

    const validationResult = dashboardInsightsSchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: validationResult.error.issues,
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

export async function getStatementFinancialsPreview(req, res, next) {
  try {
    const { business_id } = req.params;

    const validationResult = statementRangeSchema.safeParse(req.query);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.issues,
      });
    }
    const { start_date, end_date } = validationResult.data;

    // Same resolver as the PDF (statementService), so the preview and the
    // document cover identical Nairobi days. Start defaults to today; an end
    // date in the future is clamped to today.
    const { start, end } = resolveStatementRange(
      start_date ?? businessDayKey(),
      end_date
    );
    const financials = await getStatementFinancials(
      parseInt(business_id, 10),
      start,
      end
    );

    return res.status(200).json({
      success: true,
      financials,
    });
  } catch (error) {
    logger.error('Statement financials preview failed', {
      error: error.message,
      business_id: req.params.business_id,
    });
    next(error);
  }
}

/**
 * Map a service-layer error (with .code / .statusCode set by
 * statementService) to an HTTP response. Falls back to next(error) for
 * anything unrecognized, so the global error handler still catches
 * genuinely unexpected failures.
 *
 * @returns {boolean} true if a response was sent
 */
function respondToStatementError(error, res, businessId) {
  const knownCodes = [
    'STATEMENT_VALIDATION_ERROR',
    'BUSINESS_NOT_FOUND',
    'NO_RECORDS_FOUND',
    'RECORD_ITEMS_FETCH_FAILED',
    'FINGERPRINT_GENERATION_FAILED',
    'QR_CODE_GENERATION_FAILED',
    'TEMPLATE_READ_FAILED',
    'TEMPLATE_COMPILE_FAILED',
    'TEMPLATE_RENDER_FAILED',
    'PDF_ENGINE_START_FAILED',
    'PDF_RENDER_FAILED',
    'STATEMENT_AUDIT_LOG_FAILED',
    'STATEMENT_GENERATION_FAILED',
  ];

  if (!error.code || !knownCodes.includes(error.code)) {
    return false;
  }

  logger.error('Statement request failed', {
    code: error.code,
    error: error.message,
    business_id: businessId,
  });

  res.status(error.statusCode || 500).json({
    error: error.code,
    message: error.message,
    business_id: businessId,
  });

  return true;
}

/**
 * GENERATE STATEMENT: Create a bank-grade PDF statement.
 *
 * Body params:
 * - start_date (required)
 * - end_date (optional, defaults to today)
 * - statement_type: 'summary' | 'full' (default 'full')
 *     'summary' → financial position only, no per-transaction ledger.
 *     'full'    → summary + the complete, unbounded transaction ledger.
 *
 * This endpoint only ever returns a PDF. Screen-side previews use the
 * existing GET /api/records/:business_id list endpoint instead — one job
 * per endpoint, no duplicated data-fetching paths to keep in sync.
 *
 * POST /api/records/:business_id/generate-statement
 */
export async function generateStatement(req, res, next) {
  const { business_id } = req.params;

  try {
    const validationResult = generateStatementSchema.safeParse({
      ...req.body,
      business_id: parseInt(business_id),
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.issues,
      });
    }

    const { start_date, end_date, statement_type } = validationResult.data;
    const userId = req.user?.id || null;

    const { pdfBuffer, vCode } = await statementService.generateBusinessStatement(
      parseInt(business_id),
      start_date,
      end_date,
      userId,
      statement_type
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="statement_${business_id}_${statement_type}_${vCode}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    if (respondToStatementError(error, res, business_id)) {
      return;
    }

    logger.error('Generate statement endpoint failed unexpectedly', {
      error: error.message,
      business_id,
    });
    next(error);
  }
}

export default {
  createRecord,
  getRecords,
  getRecordById,
  getTotals,
  getDashboardInsights,
  getStatementFinancialsPreview,
  generateStatement,
};