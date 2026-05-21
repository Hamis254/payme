/**
 * =============================================================================
 * GOOGLE SHEETS CONTROLLER: Handle Google Sheets integration requests
 * =============================================================================
 * Manages OAuth2 flow, sheet creation, and data synchronization
 * @module controllers/googleSheets.controller
 */

import logger from '#config/logger.js';
import * as googleSheetsService from '#services/googleSheets.service.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';

/**
 * Verify user owns this business
 */
async function verifyBusinessOwnership(businessId, userId) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) {
    throw new Error('Business not found or access denied');
  }

  return business;
}

/**
 * GET /api/google-sheets/auth-url
 * Get Google OAuth2 authorization URL
 * User should visit this URL to authorize PayMe app
 */
export async function getAuthorizationUrl(req, res, next) {
  try {
    const authUrl = googleSheetsService.getGoogleAuthUrl();

    return res.status(200).json({
      success: true,
      authUrl,
      message: 'Visit this URL to authorize PayMe to access your Google Sheets',
    });
  } catch (error) {
    logger.error('Google Sheets: Get auth URL error', error);
    next(error);
  }
}

/**
 * POST /api/google-sheets/callback
 * Exchange OAuth2 authorization code for tokens
 * Body: { code: string }
 */
export async function handleOAuthCallback(req, res, next) {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const tokens = await googleSheetsService.exchangeAuthCode(code);

    return res.status(200).json({
      success: true,
      message:
        'Successfully authorized! Save refresh_token to .env for continuous access',
      tokens: {
        access_token: tokens.access_token?.substring(0, 20) + '...',
        refresh_token: tokens.refresh_token ? 'PRESENT' : 'NOT_PRESENT',
        expiry_date: tokens.expiry_date,
      },
    });
  } catch (error) {
    logger.error('Google Sheets: OAuth callback error', error);
    if (error.message.includes('invalid_grant')) {
      return res
        .status(400)
        .json({ error: 'Invalid authorization code - please try again' });
    }
    next(error);
  }
}

/**
 * POST /api/google-sheets/:businessId/create-sheet
 * Create or get a Google Sheet for this business
 * Body: { businessName?: string }
 */
export async function createBusinessSheet(req, res, next) {
  try {
    const { businessId } = req.params;
    const { businessName } = req.body;

    // Verify ownership
    const business = await verifyBusinessOwnership(
      parseInt(businessId),
      req.user.id
    );

    const sheetName = businessName || business.name;
    const result = await googleSheetsService.getOrCreateBusinessSheet(
      parseInt(businessId),
      sheetName
    );

    return res.status(200).json({
      success: true,
      data: {
        sheetId: result.sheetId,
        spreadsheetId: result.spreadsheetId,
        sheetName: result.sheetName,
        webViewLink: result.webViewLink,
      },
    });
  } catch (error) {
    logger.error('Google Sheets: Create sheet error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    if (error.message.includes('authentication')) {
      return res
        .status(401)
        .json({ error: 'Google Sheets credentials not configured' });
    }
    next(error);
  }
}

/**
 * POST /api/google-sheets/:businessId/sync-record
 * Sync a single record to Google Sheets
 * Body: { spreadsheetId: string, record: object }
 */
export async function syncRecord(req, res, next) {
  try {
    const { businessId } = req.params;
    const { spreadsheetId, record } = req.body;

    if (!spreadsheetId || !record) {
      return res.status(400).json({
        error: 'spreadsheetId and record are required',
      });
    }

    // Verify ownership
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const result = await googleSheetsService.syncRecordToGoogleSheets(
      parseInt(businessId),
      spreadsheetId,
      record
    );

    return res.status(200).json({
      success: true,
      message: result.success
        ? 'Record sync completed'
        : 'Record sync failed (non-blocking)',
      data: result,
    });
  } catch (error) {
    logger.error('Google Sheets: Sync record error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * POST /api/google-sheets/:businessId/sync-batch
 * Sync multiple records to Google Sheets (batch operation)
 * Body: { spreadsheetId: string, records: array }
 */
export async function syncRecordsBatch(req, res, next) {
  try {
    const { businessId } = req.params;
    const { spreadsheetId, records } = req.body;

    if (!spreadsheetId || !records || !Array.isArray(records)) {
      return res.status(400).json({
        error: 'spreadsheetId and records (array) are required',
      });
    }

    if (records.length === 0) {
      return res.status(400).json({
        error: 'Records array cannot be empty',
      });
    }

    // Verify ownership
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const result = await googleSheetsService.batchSyncRecords(
      parseInt(businessId),
      spreadsheetId,
      records
    );

    return res.status(200).json({
      success: true,
      message: `${records.length} records synced successfully`,
      data: {
        spreadsheetId: result.spreadsheetId,
        totalRecords: records.length,
        updates: result.updates?.map(u => ({
          updatedRange: u.updatedRange,
          rowsAppended: u.updatedRows,
        })),
      },
    });
  } catch (error) {
    logger.error('Google Sheets: Batch sync error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/google-sheets/:businessId/fetch-records
 * Fetch records from Google Sheets
 * Query params: spreadsheetId, startDate, endDate
 */
export async function fetchRecords(req, res, next) {
  try {
    const { businessId } = req.params;
    const { spreadsheetId, startDate, endDate } = req.query;

    if (!spreadsheetId) {
      return res.status(400).json({
        error: 'spreadsheetId is required',
      });
    }

    // Verify ownership
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const dateRange = {};
    if (startDate) dateRange.start_date = startDate;
    if (endDate) dateRange.end_date = endDate;

    const records = await googleSheetsService.fetchRecordsFromGoogleSheets(
      parseInt(businessId),
      spreadsheetId,
      dateRange
    );

    return res.status(200).json({
      success: true,
      data: {
        count: records.length,
        records,
      },
    });
  } catch (error) {
    logger.error('Google Sheets: Fetch records error', error);
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}
