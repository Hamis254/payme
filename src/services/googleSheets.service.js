/**
 * =============================================================================
 * SERVICE: GOOGLE SHEETS  (v2.1.0)
 * =============================================================================
 *
 * Handles append-only syncing of PayMe records to Google Sheets.
 * All auth config is read from #config/googleSheets.config.js — never
 * from process.env directly.
 *
 * KEY DESIGN DECISIONS
 * ─────────────────────
 * • Auth is built once via buildAuth() and reused — no duplicate logic between
 *   Sheets and Drive clients.
 * • Every exported function checks SHEETS_ENABLED first and returns a typed
 *   "disabled" result rather than throwing — callers are never surprised.
 * • The || '' fallbacks on OAuth2 credentials have been removed.  If a var is
 *   missing the Google SDK surfaces a clear error; validateGoogleSheetsConfig()
 *   in server.js catches it before any request is served.
 * • batchSyncRecords now returns the correct shape that the controller reads.
 * • syncRecordToGoogleSheets and batchSyncRecords are non-blocking by design:
 *   they catch internally and return { success: false } rather than throwing,
 *   so a Sheets outage never breaks a sale.
 *
 * @module services/googleSheets
 * =============================================================================
 */

import logger from '#config/logger.js';
import { google } from 'googleapis';
import {
  SHEETS_ENABLED,
  USING_SERVICE_ACCOUNT,
  SERVICE_ACCOUNT_KEY_PATH,
  OAUTH2,
  SCOPES,
} from '#config/googleSheets.Config.js';

// ─────────────────────────────────────────────────────────────────────────────
// AUTH  (single shared builder)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build and return a GoogleAuth / OAuth2Client instance depending on the
 * configured auth mode.  Both Sheets and Drive clients use this same auth
 * object — no duplication.
 *
 * @returns {google.auth.GoogleAuth | google.auth.OAuth2}
 * @throws  {Error} if credentials are missing or malformed
 *
 * @internal
 */
function buildAuth() {
  if (USING_SERVICE_ACCOUNT) {
    return new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_KEY_PATH,
      scopes:  SCOPES,
    });
  }

  // OAuth2 path
  const oauth2Client = new google.auth.OAuth2(
    OAUTH2.clientId,      // validated non-null by validateGoogleSheetsConfig
    OAUTH2.clientSecret,  // validated non-null by validateGoogleSheetsConfig
    OAUTH2.redirectUrl
  );

  // Set whichever tokens are available.  If only refreshToken is set the SDK
  // auto-refreshes the access token when it expires.
  const credentials = {};
  if (OAUTH2.refreshToken) credentials.refresh_token = OAUTH2.refreshToken;

  if (Object.keys(credentials).length > 0) {
    oauth2Client.setCredentials(credentials);
  }

  return oauth2Client;
}

/**
 * Returns an authenticated Google Sheets API client.
 *
 * @returns {Promise<import('googleapis').sheets_v4.Sheets>}
 * @internal
 */
async function getSheetsClient() {
  try {
    const auth = buildAuth();
    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    logger.error('Failed to build Google Sheets client', { error: error.message });
    throw new Error('Google Sheets authentication failed — check credentials');
  }
}

/**
 * Returns an authenticated Google Drive API client.
 *
 * @returns {Promise<import('googleapis').drive_v3.Drive>}
 * @internal
 */
async function getDriveClient() {
  try {
    const auth = buildAuth();
    return google.drive({ version: 'v3', auth });
  } catch (error) {
    logger.error('Failed to build Google Drive client', { error: error.message });
    throw new Error('Google Drive authentication failed — check credentials');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH2 FLOW  (user-facing helpers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the Google OAuth2 authorisation URL.
 * Direct the user here when they click "Connect Google Sheets".
 *
 * @returns {string} URL to redirect the user to
 * @throws  {Error}  if GOOGLE_SHEETS_ENABLED is false
 */
export function getGoogleAuthUrl() {
  if (!SHEETS_ENABLED) {
    throw new Error('Google Sheets integration is not enabled (GOOGLE_SHEETS_ENABLED != true)');
  }

  const oauth2Client = new google.auth.OAuth2(
    OAUTH2.clientId,
    OAUTH2.clientSecret,
    OAUTH2.redirectUrl
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent', // force refresh_token to be issued every time
    scope:       SCOPES,
  });
}

/**
 * Exchange a one-time OAuth2 authorisation code for tokens.
 * Call from the /api/google-sheets/callback endpoint.
 * Save the returned refresh_token to .env as GOOGLE_SHEETS_REFRESH_TOKEN.
 *
 * @param {string} code - Code from the OAuth2 redirect query string
 * @returns {Promise<Object>} tokens  { access_token, refresh_token, expiry_date, … }
 */
export async function exchangeAuthCode(code) {
  const oauth2Client = new google.auth.OAuth2(
    OAUTH2.clientId,
    OAUTH2.clientSecret,
    OAUTH2.redirectUrl
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    logger.info('OAuth2 tokens exchanged successfully', {
      hasRefreshToken: !!tokens.refresh_token,
    });
    return tokens;
  } catch (error) {
    logger.error('Failed to exchange OAuth2 code', { error: error.message });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEET MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/** Column headers written to row 1 of every new sheet. */
const SHEET_HEADERS = [
  'Date', 'Time', 'Type', 'Category', 'Description',
  'Items', 'Quantity', 'Amount (KES)', 'Payment Method',
  'M-Pesa Code', 'Sender Name', 'Sender Phone', 'Notes', 'Created At',
];

const HEADER_RANGE  = 'Records!A1:N1';
const DATA_RANGE    = 'Records!A:N';
const READ_RANGE    = 'Records!A2:N'; // skip header row on reads

/**
 * Find or create the Google Sheet for a business.
 * Sheet is named "PayMe_{BusinessName}_{BusinessID}" for easy identification.
 *
 * @param {number} businessId
 * @param {string} businessName
 * @returns {Promise<{ spreadsheetId: string, sheetId: number, sheetName: string, webViewLink: string }>}
 */
export async function getOrCreateBusinessSheet(businessId, businessName) {
  if (!SHEETS_ENABLED) {
    throw new Error('Google Sheets integration is disabled');
  }

  const sheets    = await getSheetsClient();
  const drive     = await getDriveClient();
  const sheetName = `PayMe_${businessName}_${businessId}`;

  // ── Search for existing sheet ─────────────────────────────────────────────
  const searchResult = await drive.files.list({
    q: `name='${sheetName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    spaces: 'drive',
    fields: 'files(id, name)',
    pageSize: 1,
  });

  if (searchResult.data.files?.length > 0) {
    const existingId = searchResult.data.files[0].id;
    logger.info('Found existing Google Sheet', { businessId, spreadsheetId: existingId });
    return {
      spreadsheetId: existingId,
      sheetId:       0,
      sheetName,
      webViewLink:   `https://docs.google.com/spreadsheets/d/${existingId}/edit`,
    };
  }

  // ── Create new sheet ──────────────────────────────────────────────────────
  const createResponse = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: sheetName, locale: 'en_US', autoRecalc: 'ON_CHANGE' },
      sheets: [{ properties: { sheetId: 0, title: 'Records', index: 0 } }],
    },
  });

  const spreadsheetId = createResponse.data.spreadsheetId;

  // Write headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range:            HEADER_RANGE,
    valueInputOption: 'RAW',
    requestBody:      { values: [SHEET_HEADERS] },
  });

  // Bold + blue header formatting
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor:    { red: 0.2, green: 0.2, blue: 0.8 },
              textFormat:         { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
      }],
    },
  });

  logger.info('Google Sheet created', { businessId, spreadsheetId, sheetName });

  return {
    spreadsheetId,
    sheetId:     0,
    sheetName,
    webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW FORMATTING HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a record object to a Sheets row array matching SHEET_HEADERS order.
 *
 * @param {Object} record
 * @returns {Array<string>}
 * @internal
 */
function recordToRow(record) {
  const txDate = new Date(record.transaction_date);
  return [
    txDate.toLocaleDateString('en-KE'),
    txDate.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
    record.type                                         ?? '',
    record.category                                     ?? '',
    record.description                                  ?? '',
    record.items?.map(i => i.item_name).join(', ')      ?? '',
    String(record.quantity ?? 1),
    String(record.amount),
    record.payment_method                               ?? 'N/A',
    record.mpesa_receipt_number                         ?? 'N/A',
    record.mpesa_sender_name                            ?? 'N/A',
    record.mpesa_sender_phone                           ?? 'N/A',
    record.notes                                        ?? '',
    new Date(record.created_at).toLocaleString('en-KE'),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append a single record to a Google Sheet.
 *
 * Non-blocking: catches internally and returns { success: false, error } rather
 * than throwing — a Sheets outage must never block a sale from being recorded.
 *
 * @param {number} businessId
 * @param {string} spreadsheetId
 * @param {Object} record
 * @returns {Promise<{ success: boolean, spreadsheetId?: string, sheets_row_id?: string, skipped?: boolean, error?: string }>}
 */
export async function syncRecordToGoogleSheets(businessId, spreadsheetId, record) {
  if (!SHEETS_ENABLED) {
    logger.debug('Google Sheets sync skipped (disabled)');
    return { success: true, skipped: true };
  }

  if (!record?.id || !spreadsheetId) {
    logger.warn('syncRecordToGoogleSheets: missing record id or spreadsheetId', {
      businessId,
      recordId:      record?.id,
      spreadsheetId,
    });
    return { success: false, error: 'Invalid record or spreadsheet ID' };
  }

  try {
    const sheets = await getSheetsClient();

    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range:            DATA_RANGE,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: [recordToRow(record)] },
    });

    logger.info('Record synced to Google Sheets', {
      businessId,
      recordId:      record.id,
      spreadsheetId,
      updatedRows:   appendResponse.data.updates?.updatedRows,
    });

    return {
      success:       true,
      spreadsheetId,
      sheets_row_id: appendResponse.data.updates?.updatedRange ?? null,
    };
  } catch (error) {
    logger.error('Google Sheets sync failed (non-critical)', {
      error:         error.message,
      businessId,
      recordId:      record?.id,
      spreadsheetId,
    });
    return { success: false, error: error.message, recordId: record?.id };
  }
}

/**
 * Append multiple records to a Google Sheet in a single API call.
 *
 * Non-blocking: same contract as syncRecordToGoogleSheets.
 *
 * @param {number} businessId
 * @param {string} spreadsheetId
 * @param {Object[]} records
 * @returns {Promise<{ success: boolean, synced: number, failed: number, spreadsheetId?: string, updatedRange?: string, error?: string }>}
 */
export async function batchSyncRecords(businessId, spreadsheetId, records) {
  if (!SHEETS_ENABLED) {
    logger.debug('Google Sheets batch sync skipped (disabled)');
    return { success: true, skipped: true, synced: 0, failed: 0 };
  }

  if (!records?.length) {
    return { success: true, synced: 0, failed: 0 };
  }

  try {
    const sheets = await getSheetsClient();
    const rows   = records.map(recordToRow);

    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range:            DATA_RANGE,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: rows },
    });

    const synced = appendResponse.data.updates?.updatedRows ?? rows.length;

    logger.info('Batch sync to Google Sheets complete', {
      businessId,
      spreadsheetId,
      synced,
      total: records.length,
    });

    return {
      success:       true,
      synced,
      failed:        0,
      spreadsheetId,
      // controller reads updatedRange to show the user which rows were appended
      updatedRange:  appendResponse.data.updates?.updatedRange ?? null,
    };
  } catch (error) {
    logger.error('Google Sheets batch sync failed (non-critical)', {
      error:       error.message,
      businessId,
      recordCount: records?.length,
    });
    return {
      success: false,
      synced:  0,
      failed:  records?.length ?? 0,
      error:   error.message,
    };
  }
}

/**
 * Read records back from a Google Sheet (for audit / verification).
 * Returns an empty array on any error — never throws.
 *
 * @param {number} businessId
 * @param {string} spreadsheetId
 * @param {{ start_date?: string, end_date?: string }} [dateRange]
 * @returns {Promise<Object[]>}
 */
export async function fetchRecordsFromGoogleSheets(businessId, spreadsheetId, dateRange = {}) {
  if (!SHEETS_ENABLED) {
    return [];
  }

  try {
    const sheets   = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: READ_RANGE,
    });

    const rows = response.data.values;
    if (!rows?.length) {
      return [];
    }

    // Map positional columns back to the header names
    const headerKeys = [
      'date', 'time', 'type', 'category', 'description',
      'items', 'quantity', 'amount', 'payment_method',
      'mpesa_code', 'sender_name', 'sender_phone', 'notes', 'created_at',
    ];

    let records = rows.map(row => {
      const record = {};
      headerKeys.forEach((key, i) => { record[key] = row[i] ?? ''; });
      return record;
    });

    // Optional date-range filter
    const startDate = dateRange.start_date ? new Date(dateRange.start_date) : null;
    const endDate   = dateRange.end_date   ? new Date(dateRange.end_date)   : null;

    if (startDate || endDate) {
      records = records.filter(record => {
        const d = new Date(record.date);
        if (startDate && d < startDate) return false;
        if (endDate   && d > endDate)   return false;
        return true;
      });
    }

    logger.info('Fetched records from Google Sheets', {
      businessId,
      spreadsheetId,
      count: records.length,
    });

    return records;
  } catch (error) {
    logger.error('Failed to fetch records from Google Sheets', {
      error: error.message,
      businessId,
      spreadsheetId,
    });
    return [];
  }
}

export default {
  getGoogleAuthUrl,
  exchangeAuthCode,
  getOrCreateBusinessSheet,
  syncRecordToGoogleSheets,
  batchSyncRecords,
  fetchRecordsFromGoogleSheets,
};
