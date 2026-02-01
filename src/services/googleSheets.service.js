/**
 * =============================================================================
 * GOOGLE SHEETS SERVICE: Real-time data synchronization
 * =============================================================================
 * Handles append-only syncing of records to Google Sheets
 * Supports per-business sheets with auto-formatting
 * Requires OAuth2 credentials setup in Google Cloud Console
 * @module services/googleSheets.service
 * @version 2.0.0
 */

import logger from '#config/logger.js';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];

/**
 * GET AUTHENTICATED GOOGLE SHEETS CLIENT
 * Uses OAuth2 credentials from environment or service account
 * Required env vars:
 *   - GOOGLE_SHEETS_CLIENT_ID (leave blank for service account)
 *   - GOOGLE_SHEETS_CLIENT_SECRET (leave blank for service account)
 *   - GOOGLE_SHEETS_REFRESH_TOKEN (or will be generated via OAuth)
 *   - GOOGLE_SHEETS_ACCESS_TOKEN (cached access token)
 *   - GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY (JSON path for service account - alternative)
 *
 * @returns {Promise<Object>} Authenticated Sheets API client
 */
async function getAuthenticatedClient() {
  try {
    // Check if using service account (recommended for server-to-server)
    if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY) {
      const keyFile = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY;
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: SCOPES,
      });
      return google.sheets({ version: 'v4', auth });
    }

    // Use OAuth2 flow (for user-authorized access)
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_SHEETS_CLIENT_ID || '',
      process.env.GOOGLE_SHEETS_CLIENT_SECRET || '',
      process.env.GOOGLE_SHEETS_REDIRECT_URL || 'http://localhost:3000/auth/google-callback'
    );

    // Set refresh token if available
    if (process.env.GOOGLE_SHEETS_REFRESH_TOKEN) {
      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_SHEETS_REFRESH_TOKEN,
      });
    }

    // If access token cached, use it
    if (process.env.GOOGLE_SHEETS_ACCESS_TOKEN) {
      oauth2Client.setCredentials({
        access_token: process.env.GOOGLE_SHEETS_ACCESS_TOKEN,
      });
    }

    return google.sheets({ version: 'v4', auth: oauth2Client });
  } catch (error) {
    logger.error('Failed to get authenticated Google Sheets client', {
      error: error.message,
    });
    throw new Error('Google Sheets authentication failed - check credentials');
  }
}

/**
 * GENERATE OAUTH2 AUTHORIZATION URL
 * Returns URL for user to authorize PayMe app
 * Call this when user clicks "Connect Google Sheets"
 *
 * @returns {string} Authorization URL
 */
export function getGoogleAuthUrl() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_SHEETS_CLIENT_ID || '',
    process.env.GOOGLE_SHEETS_CLIENT_SECRET || '',
    process.env.GOOGLE_SHEETS_REDIRECT_URL || 'http://localhost:3000/auth/google-callback'
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
}

/**
 * EXCHANGE OAUTH2 AUTH CODE FOR TOKENS
 * Call this from /auth/google-callback endpoint
 * Save refresh_token to env for future use
 *
 * @param {string} code - Authorization code from OAuth redirect
 * @returns {Promise<Object>} Tokens including refresh_token
 */
export async function exchangeAuthCode(code) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_SHEETS_CLIENT_ID || '',
      process.env.GOOGLE_SHEETS_CLIENT_SECRET || '',
      process.env.GOOGLE_SHEETS_REDIRECT_URL || 'http://localhost:3000/auth/google-callback'
    );

    const { tokens } = await oauth2Client.getToken(code);
    logger.info('OAuth2 tokens exchanged successfully', {
      hasRefreshToken: !!tokens.refresh_token,
    });

    return tokens;
  } catch (error) {
    logger.error('Failed to exchange OAuth2 code', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * GET OR CREATE BUSINESS SHEET
 * Creates a new Google Sheet for business if it doesn't exist
 * Names sheet: "PayMe_{BusinessName}_{BusinessID}"
 * Auto-creates headers and formatting
 *
 * @param {number} businessId - Business ID
 * @param {string} businessName - Business name
 * @returns {Promise<string>} Spreadsheet ID
 */
export async function getOrCreateBusinessSheet(businessId, businessName) {
  try {
    const sheets = await getAuthenticatedClient();
    const drive = google.drive({ version: 'v3' });

    const sheetName = `PayMe_${businessName}_${businessId}`;

    // Search for existing sheet
    const searchResults = await drive.files.list({
      q: `name='${sheetName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id, name)',
      pageSize: 1,
    });

    if (searchResults.data.files && searchResults.data.files.length > 0) {
      logger.info('Found existing Google Sheet', {
        businessId,
        sheetId: searchResults.data.files[0].id,
      });
      return searchResults.data.files[0].id;
    }

    // Create new sheet if not found
    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: sheetName,
          locale: 'en_US',
          autoRecalc: 'ON_CHANGE',
        },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Records',
              index: 0,
            },
          },
        ],
      },
    });

    const spreadsheetId = createResponse.data.spreadsheetId;

    // Add headers
    const headers = [
      'Date',
      'Time',
      'Type',
      'Category',
      'Description',
      'Items',
      'Quantity',
      'Amount (KES)',
      'Payment Method',
      'M-Pesa Code',
      'Sender Name',
      'Sender Phone',
      'Notes',
      'Created At',
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Records!A1:N1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });

    // Format headers (bold, background color)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.2, green: 0.2, blue: 0.8 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  horizontalAlignment: 'CENTER',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
          },
        ],
      },
    });

    logger.info('Google Sheet created successfully', {
      businessId,
      spreadsheetId,
      sheetName,
    });

    return spreadsheetId;
  } catch (error) {
    logger.error('Failed to get/create business sheet', {
      error: error.message,
      businessId,
      businessName,
    });
    throw error;
  }
}

/**
 * SYNC RECORD TO GOOGLE SHEETS
 * Appends new record as row to Google Sheet (append-only, no overwrites)
 * Maintains data integrity for audit trail
 * Non-blocking: Failures don't prevent record creation
 *
 * @param {number} businessId - Business ID
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {Object} record - Record to sync (with items array)
 * @returns {Promise<Object>} Sync result with row ID
 */
export async function syncRecordToGoogleSheets(businessId, spreadsheetId, record) {
  try {
    if (!process.env.GOOGLE_SHEETS_ENABLED) {
      logger.debug('Google Sheets sync disabled, skipping');
      return { success: true, skipped: true };
    }

    // Validate record
    if (!record || !record.id || !spreadsheetId) {
      throw new Error('Invalid record or spreadsheet ID for sync');
    }

    const sheets = await getAuthenticatedClient();

    // Format row data
    const rowData = [
      [
        new Date(record.transaction_date).toLocaleDateString('en-KE'),
        new Date(record.transaction_date).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
        record.type,
        record.category,
        record.description || '',
        record.items?.map(i => i.item_name).join(', ') || '',
        record.quantity || 1,
        record.amount.toString(),
        record.payment_method || 'N/A',
        record.mpesa_receipt_number || 'N/A',
        record.mpesa_sender_name || 'N/A',
        record.mpesa_sender_phone || 'N/A',
        record.notes || '',
        new Date(record.created_at).toLocaleString('en-KE'),
      ],
    ];

    // Append to sheet
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Records!A:N',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rowData,
      },
    });

    logger.info('Record synced to Google Sheets', {
      businessId,
      recordId: record.id,
      spreadsheetId,
      appendedRows: appendResponse.data.updates.updatedRows,
    });

    return {
      success: true,
      spreadsheetId,
      sheets_row_id: appendResponse.data.updates.updatedRange,
    };
  } catch (error) {
    logger.error('Google Sheets sync failed (non-critical)', {
      error: error.message,
      businessId,
      recordId: record?.id,
    });
    // Non-blocking: Return sync error but don't throw
    return {
      success: false,
      error: error.message,
      recordId: record?.id,
    };
  }
}

/**
 * BATCH SYNC RECORDS
 * Syncs multiple records at once (for backfill or recovery)
 * Non-blocking: Failures don't prevent main operation
 *
 * @param {number} businessId - Business ID
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {Array} records - Array of records to sync
 * @returns {Promise<Object>} Batch sync result
 */
export async function batchSyncRecords(businessId, spreadsheetId, records) {
  try {
    if (!records || records.length === 0) {
      return { success: true, synced: 0, failed: 0 };
    }

    const sheets = await getAuthenticatedClient();

    // Prepare all rows
    const rowsData = records.map(record => [
      new Date(record.transaction_date).toLocaleDateString('en-KE'),
      new Date(record.transaction_date).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
      record.type,
      record.category,
      record.description || '',
      record.items?.map(i => i.item_name).join(', ') || '',
      record.quantity || 1,
      record.amount.toString(),
      record.payment_method || 'N/A',
      record.mpesa_receipt_number || 'N/A',
      record.mpesa_sender_name || 'N/A',
      record.mpesa_sender_phone || 'N/A',
      record.notes || '',
      new Date(record.created_at).toLocaleString('en-KE'),
    ]);

    // Append all rows
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Records!A:N',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rowsData,
      },
    });

    const synced = appendResponse.data.updates.updatedRows || rowsData.length;
    const failed = 0;

    logger.info('Batch sync completed', {
      businessId,
      spreadsheetId,
      synced,
      failed,
      total: records.length,
    });

    return { success: true, synced, failed };
  } catch (error) {
    logger.error('Batch sync failed', {
      error: error.message,
      businessId,
      recordCount: records?.length,
    });
    // Non-blocking: Return error details without throwing
    return {
      success: false,
      synced: 0,
      failed: records?.length || 0,
      error: error.message,
    };
  }
}

/**
 * FETCH RECORDS FROM GOOGLE SHEETS
 * Reads records from Google Sheet (for verification/audit)
 * Filters by date range if provided
 *
 * @param {number} businessId - Business ID
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {Object} dateRange - { start_date, end_date } (optional)
 * @returns {Promise<Array>} Records from Google Sheets
 */
export async function fetchRecordsFromGoogleSheets(businessId, spreadsheetId, dateRange = {}) {
  try {
    const sheets = await getAuthenticatedClient();

    // Fetch all data from Records sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Records!A2:N', // Skip headers (row 1)
    });

    if (!response.data.values || response.data.values.length === 0) {
      logger.info('No records found in Google Sheets', {
        businessId,
        spreadsheetId,
      });
      return [];
    }

    // Convert rows to objects using headers
    const headers = [
      'date',
      'time',
      'type',
      'category',
      'description',
      'items',
      'quantity',
      'amount',
      'payment_method',
      'mpesa_code',
      'sender_name',
      'sender_phone',
      'notes',
      'created_at',
    ];

    const records = response.data.values.map(row => {
      const record = {};
      headers.forEach((header, idx) => {
        record[header] = row[idx] || '';
      });
      return record;
    });

    // Filter by date range if provided
    if (dateRange.start_date || dateRange.end_date) {
      const startDate = dateRange.start_date ? new Date(dateRange.start_date) : new Date('2000-01-01');
      const endDate = dateRange.end_date ? new Date(dateRange.end_date) : new Date();

      return records.filter(record => {
        const recordDate = new Date(record.date);
        return recordDate >= startDate && recordDate <= endDate;
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
    // Non-blocking: Return empty array instead of throwing
    return [];
  }
}

export default {
  getAuthenticatedClient,
  getGoogleAuthUrl,
  exchangeAuthCode,
  getOrCreateBusinessSheet,
  syncRecordToGoogleSheets,
  batchSyncRecords,
  fetchRecordsFromGoogleSheets,
};
