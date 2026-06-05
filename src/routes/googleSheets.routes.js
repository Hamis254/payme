/**
 * =============================================================================
 * ROUTES: GOOGLE SHEETS
 * =============================================================================
 * DB → Sheets export only.  Sheets → DB import is intentionally absent
 * to prevent circular dependency and data inconsistency if the Sheet is
 * edited manually.
 *
 * CHANGES FROM ORIGINAL:
 *   • fetch-records route restored (controller had the handler, route was
 *     missing — now aligned)
 *   • validateBusinessId removed from routes that already set it via the
 *     controller's verifyBusinessOwnership call — no double-query
 *
 * Mount point: /api/google-sheets   (set in app.js)
 * =============================================================================
 */

import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import * as googleSheetsController from '#controllers/googleSheets.controller.js';

const router = express.Router();

// ─── Public (no auth) ────────────────────────────────────────────────────────

/**
 * GET /api/google-sheets/auth-url
 * Returns the OAuth2 URL the user visits to authorise PayMe.
 * In service-account mode returns a helpful message instead.
 */
router.get('/auth-url', googleSheetsController.getAuthorizationUrl);

/**
 * POST /api/google-sheets/callback
 * Exchanges a one-time OAuth2 code for tokens.
 * Body: { code: string }
 */
router.post('/callback', googleSheetsController.handleOAuthCallback);

// ─── Authenticated ────────────────────────────────────────────────────────────

router.use(authenticateToken);

/**
 * POST /api/google-sheets/:businessId/create-sheet
 * Find or create the Google Sheet for this business.
 * Body: { businessName?: string }
 */
router.post('/:businessId/create-sheet', googleSheetsController.createBusinessSheet);

/**
 * POST /api/google-sheets/:businessId/sync-record
 * Append a single record to the business's Google Sheet.
 * Body: { spreadsheetId: string, record: object }
 */
router.post('/:businessId/sync-record', googleSheetsController.syncRecord);

/**
 * POST /api/google-sheets/:businessId/sync-batch
 * Append multiple records in one API call.
 * Body: { spreadsheetId: string, records: object[] }
 */
router.post('/:businessId/sync-batch', googleSheetsController.syncRecordsBatch);

/**
 * GET /api/google-sheets/:businessId/fetch-records
 * Read records back from the Sheet for audit/verification (read-only).
 * Query params: spreadsheetId (required), startDate, endDate (ISO strings)
 */
router.get('/:businessId/fetch-records', googleSheetsController.fetchRecords);

export default router;
