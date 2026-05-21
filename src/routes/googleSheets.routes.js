/**
 * =============================================================================
 * GOOGLE SHEETS ROUTES: Google Sheets integration endpoints
 * =============================================================================
 * Export-only (DB → Sheets). Importing from Sheets is intentionally removed
 * to prevent circular dependency and data inconsistency if Sheets is edited.
 */

import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { validateBusinessId } from '#middleware/businessId.middleware.js';
import * as googleSheetsController from '#controllers/googleSheets.controller.js';

const router = express.Router();

/**
 * GET /api/google-sheets/auth-url
 * Get Google OAuth2 authorization URL.
 * Public endpoint — no auth required.
 */
router.get('/auth-url', googleSheetsController.getAuthorizationUrl);

/**
 * POST /api/google-sheets/callback
 * Exchange OAuth2 authorization code for tokens.
 * Public endpoint — no auth required.
 * Body: { code: string }
 */
router.post('/callback', googleSheetsController.handleOAuthCallback);

// All remaining routes require authentication
router.use(authenticateToken);

/**
 * POST /api/google-sheets/:businessId/create-sheet
 * Create or get a Google Sheet for this business.
 * Body: { businessName?: string }
 */
router.post(
  '/:businessId/create-sheet',
  validateBusinessId('params'),
  googleSheetsController.createBusinessSheet
);

/**
 * POST /api/google-sheets/:businessId/sync-record
 * Sync a single record to Google Sheets.
 * Body: { spreadsheetId: string, record: object }
 */
router.post(
  '/:businessId/sync-record',
  validateBusinessId('params'),
  googleSheetsController.syncRecord
);

/**
 * POST /api/google-sheets/:businessId/sync-batch
 * Sync multiple records to Google Sheets (batch operation).
 * Body: { spreadsheetId: string, records: array }
 */
router.post(
  '/:businessId/sync-batch',
  validateBusinessId('params'),
  googleSheetsController.syncRecordsBatch
);

// NOTE: fetch-records route intentionally removed.
// PayMe uses DB as the single source of truth.
// Google Sheets is export-only (DB → Sheets).

export default router;
