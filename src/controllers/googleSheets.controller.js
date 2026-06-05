/**
 * =============================================================================
 * CONTROLLER: GOOGLE SHEETS
 * =============================================================================
 * Handles OAuth2 flow, sheet creation, and data sync endpoints.
 * Routes are in googleSheets.routes.js.
 *
 * All business-ownership verification uses the shared verifyBusinessOwnership
 * helper — same pattern as reconciliation.controller.js.
 *
 * FIXES FROM ORIGINAL:
 *   • syncRecordsBatch response now reads result.updatedRange (correct shape)
 *     instead of result.updates?.map(…) which was undefined
 *   • fetchRecords handler added back (was removed from routes but controller
 *     still had it — now both aligned: route + handler both present)
 *   • SHEETS_ENABLED checked at the start of each handler — returns 503 with
 *     a clear message instead of crashing mid-handler if feature is disabled
 *   • getAuthorizationUrl guards against non-OAuth2 mode (service account
 *     doesn't need an auth URL)
 *
 * @module controllers/googleSheets
 * =============================================================================
 */

import logger from '#config/logger.js';
import * as googleSheetsService from '#services/googleSheets.service.js';
import { SHEETS_ENABLED, USING_SERVICE_ACCOUNT } from '#config/googleSheets.Config.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { eq, and } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify that req.user owns the given businessId.
 * Throws with a consistent message that the handlers catch and map to 403.
 */
async function verifyBusinessOwnership(businessId, userId) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) throw new Error('Business not found or access denied');
  return business;
}

/**
 * Shorthand: return 503 when the Google Sheets feature is disabled.
 * Keeps each handler lean — call this at the top of every handler.
 */
const sheetsDisabledResponse = res =>
  res.status(503).json({
    error:   'Google Sheets integration is not enabled',
    message: 'Set GOOGLE_SHEETS_ENABLED=true and provide the required credentials in .env',
  });

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH2 FLOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/google-sheets/auth-url
 *
 * Returns the Google OAuth2 URL the user must visit to authorise PayMe.
 * Only meaningful in OAuth2 mode.  In service-account mode this endpoint
 * is not needed — return a helpful message explaining why.
 */
export async function getAuthorizationUrl(req, res, next) {
  try {
    if (!SHEETS_ENABLED) return sheetsDisabledResponse(res);

    if (USING_SERVICE_ACCOUNT) {
      return res.status(200).json({
        success: true,
        message:
          'Service account auth is configured — no OAuth2 flow required. ' +
          'Share your Google Sheet with the service account email and you are ready.',
        auth_mode: 'service_account',
      });
    }

    const authUrl = googleSheetsService.getGoogleAuthUrl();

    return res.status(200).json({
      success:  true,
      auth_mode: 'oauth2',
      authUrl,
      message:
        'Visit authUrl to authorise PayMe. After authorisation you will be ' +
        'redirected to your callback URL with a ?code= parameter. POST that ' +
        'code to /api/google-sheets/callback to exchange it for tokens.',
    });
  } catch (error) {
    logger.error('Google Sheets: getAuthorizationUrl error', { error: error.message });
    next(error);
  }
}

/**
 * POST /api/google-sheets/callback
 *
 * Exchange a one-time OAuth2 authorisation code for tokens.
 * Body: { code: string }
 *
 * The returned refresh_token must be saved to .env as
 * GOOGLE_SHEETS_REFRESH_TOKEN for continuous access.
 */
export async function handleOAuthCallback(req, res, next) {
  try {
    if (!SHEETS_ENABLED) return sheetsDisabledResponse(res);

    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const tokens = await googleSheetsService.exchangeAuthCode(code);

    return res.status(200).json({
      success: true,
      message:
        'Authorised successfully. Copy the refresh_token below and save it ' +
        'as GOOGLE_SHEETS_REFRESH_TOKEN in your .env file.',
      tokens: {
        // Show only a prefix of the access token — it's short-lived anyway
        access_token:  tokens.access_token
          ? tokens.access_token.substring(0, 20) + '…'
          : null,
        // Expose the full refresh token — the user needs to copy it to .env
        refresh_token: tokens.refresh_token ?? null,
        expiry_date:   tokens.expiry_date   ?? null,
      },
      next_step:
        tokens.refresh_token
          ? 'Add GOOGLE_SHEETS_REFRESH_TOKEN=<refresh_token> to .env and restart the server.'
          : 'No refresh_token returned. Revoke app access in your Google account and try again.',
    });
  } catch (error) {
    logger.error('Google Sheets: handleOAuthCallback error', { error: error.message });
    if (error.message?.includes('invalid_grant')) {
      return res.status(400).json({
        error:   'Invalid or expired authorization code',
        message: 'Authorization codes are single-use and expire quickly. Start the flow again.',
      });
    }
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEET MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/google-sheets/:businessId/create-sheet
 *
 * Find or create the Google Sheet for this business.
 * Body: { businessName?: string }
 */
export async function createBusinessSheet(req, res, next) {
  try {
    if (!SHEETS_ENABLED) return sheetsDisabledResponse(res);

    const { businessId } = req.params;
    const business = await verifyBusinessOwnership(parseInt(businessId), req.user.id);
    const sheetName = req.body.businessName || business.name;

    const result = await googleSheetsService.getOrCreateBusinessSheet(
      parseInt(businessId),
      sheetName
    );

    return res.status(200).json({
      success: true,
      data: {
        spreadsheetId: result.spreadsheetId,
        sheetId:       result.sheetId,
        sheetName:     result.sheetName,
        webViewLink:   result.webViewLink,
      },
    });
  } catch (error) {
    logger.error('Google Sheets: createBusinessSheet error', { error: error.message });
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    if (error.message?.includes('authentication')) {
      return res.status(401).json({
        error:   'Google Sheets credentials not configured correctly',
        message: error.message,
      });
    }
    next(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC  (DB → Sheets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/google-sheets/:businessId/sync-record
 *
 * Append a single record to the business's Google Sheet.
 * Body: { spreadsheetId: string, record: object }
 */
export async function syncRecord(req, res, next) {
  try {
    if (!SHEETS_ENABLED) return sheetsDisabledResponse(res);

    const { businessId } = req.params;
    const { spreadsheetId, record } = req.body;

    if (!spreadsheetId || !record) {
      return res.status(400).json({ error: 'spreadsheetId and record are required' });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const result = await googleSheetsService.syncRecordToGoogleSheets(
      parseInt(businessId),
      spreadsheetId,
      record
    );

    return res.status(200).json({
      success: true,
      message: result.success ? 'Record synced to Google Sheets' : 'Sync failed (non-blocking)',
      data: result,
    });
  } catch (error) {
    logger.error('Google Sheets: syncRecord error', { error: error.message });
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * POST /api/google-sheets/:businessId/sync-batch
 *
 * Append multiple records in a single API call.
 * Body: { spreadsheetId: string, records: object[] }
 */
export async function syncRecordsBatch(req, res, next) {
  try {
    if (!SHEETS_ENABLED) return sheetsDisabledResponse(res);

    const { businessId } = req.params;
    const { spreadsheetId, records } = req.body;

    if (!spreadsheetId || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        error: 'spreadsheetId and a non-empty records array are required',
      });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const result = await googleSheetsService.batchSyncRecords(
      parseInt(businessId),
      spreadsheetId,
      records
    );

    return res.status(200).json({
      success: true,
      message: result.success
        ? `${result.synced} of ${records.length} records synced`
        : 'Batch sync failed (non-blocking)',
      data: {
        spreadsheetId,
        totalRecords:  records.length,
        synced:        result.synced,
        failed:        result.failed,
        // result.updatedRange is the actual Sheets A1 range that was written,
        // e.g. "Records!A5:N104" — useful for the user to know where rows landed
        updatedRange:  result.updatedRange ?? null,
        error:         result.error ?? null,
      },
    });
  } catch (error) {
    logger.error('Google Sheets: syncRecordsBatch error', { error: error.message });
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * GET /api/google-sheets/:businessId/fetch-records
 *
 * Read records back from Google Sheets for audit / verification.
 * Query params: spreadsheetId, startDate (ISO), endDate (ISO)
 *
 * NOTE: PayMe uses the DB as the single source of truth.
 * This endpoint is read-only and exists for auditing only.
 */
export async function fetchRecords(req, res, next) {
  try {
    if (!SHEETS_ENABLED) return sheetsDisabledResponse(res);

    const { businessId } = req.params;
    const { spreadsheetId, startDate, endDate } = req.query;

    if (!spreadsheetId) {
      return res.status(400).json({ error: 'spreadsheetId query param is required' });
    }

    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const dateRange = {};
    if (startDate) dateRange.start_date = startDate;
    if (endDate)   dateRange.end_date   = endDate;

    const records = await googleSheetsService.fetchRecordsFromGoogleSheets(
      parseInt(businessId),
      spreadsheetId,
      dateRange
    );

    return res.status(200).json({
      success: true,
      data:    { count: records.length, records },
    });
  } catch (error) {
    logger.error('Google Sheets: fetchRecords error', { error: error.message });
    if (error.message === 'Business not found or access denied') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  }
}

export default {
  getAuthorizationUrl,
  handleOAuthCallback,
  createBusinessSheet,
  syncRecord,
  syncRecordsBatch,
  fetchRecords,
};
