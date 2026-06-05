/**
 * =============================================================================
 * CONFIG: GOOGLE SHEETS
 * =============================================================================
 *
 * Single source of truth for every Google Sheets environment variable.
 * Imported by googleSheets.service.js — no other file reads process.env
 * for these vars directly.
 *
 * TWO AUTH MODES (mutually exclusive, service account takes priority):
 *
 *   1. SERVICE ACCOUNT (recommended for production server-to-server)
 *      Set GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY to the absolute path of your
 *      service account JSON file downloaded from Google Cloud Console.
 *      No user interaction needed. Sheets must be shared with the service
 *      account email (e.g. payme@my-project.iam.gserviceaccount.com).
 *
 *   2. OAUTH2 (for user-authorized access)
 *      Set CLIENT_ID + CLIENT_SECRET + REDIRECT_URL.
 *      User visits /api/google-sheets/auth-url, authorises, and the callback
 *      exchanges the code for tokens.  Save the refresh_token to
 *      GOOGLE_SHEETS_REFRESH_TOKEN in .env for continuous access.
 *
 * REQUIRED .env vars (per chosen auth mode):
 *
 *   Mode 1 — service account:
 *     GOOGLE_SHEETS_ENABLED=true
 *     GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY=/path/to/service-account.json
 *
 *   Mode 2 — OAuth2:
 *     GOOGLE_SHEETS_ENABLED=true
 *     GOOGLE_SHEETS_CLIENT_ID=<from Google Cloud Console>
 *     GOOGLE_SHEETS_CLIENT_SECRET=<from Google Cloud Console>
 *     GOOGLE_SHEETS_REDIRECT_URL=https://yourdomain.com/api/google-sheets/callback
 *     GOOGLE_SHEETS_REFRESH_TOKEN=<saved after first OAuth2 dance>
 *
 * @module config/googleSheets
 * =============================================================================
 */

import { existsSync } from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// IS THE FEATURE ENABLED?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Master switch.  Every service function checks this first.
 * Set GOOGLE_SHEETS_ENABLED=true in .env to activate.
 * All other vars are only required when this is true.
 */
export const SHEETS_ENABLED =
  process.env.GOOGLE_SHEETS_ENABLED?.toLowerCase() === 'true';

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MODE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/** Path to service account JSON file. Takes priority over OAuth2. */
export const SERVICE_ACCOUNT_KEY_PATH =
  process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY ?? null;

/** True when a service account key path has been provided. */
export const USING_SERVICE_ACCOUNT = !!SERVICE_ACCOUNT_KEY_PATH;

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH2 CREDENTIALS  (only used when USING_SERVICE_ACCOUNT is false)
// ─────────────────────────────────────────────────────────────────────────────

export const OAUTH2 = {
  clientId:     process.env.GOOGLE_SHEETS_CLIENT_ID     ?? null,
  clientSecret: process.env.GOOGLE_SHEETS_CLIENT_SECRET ?? null,
  redirectUrl:  process.env.GOOGLE_SHEETS_REDIRECT_URL  ??
                  'http://localhost:3000/api/google-sheets/callback',
  refreshToken: process.env.GOOGLE_SHEETS_REFRESH_TOKEN ?? null,
};

// ─────────────────────────────────────────────────────────────────────────────
// SCOPES
// ─────────────────────────────────────────────────────────────────────────────

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION  (called once at startup from server.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that all required env vars for the chosen auth mode are present.
 * Returns an array of human-readable error strings.  Empty array = valid.
 *
 * Call this from server.js after loading env.  If errors.length > 0, log and
 * exit so the team sees a clear message instead of a cryptic mid-request crash.
 *
 * @returns {string[]}  validation error messages (empty = all good)
 *
 * @example
 * // server.js
 * import { validateGoogleSheetsConfig } from '#config/googleSheets.config.js';
 * const errs = validateGoogleSheetsConfig();
 * if (errs.length) {
 *   errs.forEach(e => logger.error(e));
 *   process.exit(1);
 * }
 */
export const validateGoogleSheetsConfig = () => {
  // Feature is off — nothing to validate
  if (!SHEETS_ENABLED) return [];

  const errors = [];

  if (USING_SERVICE_ACCOUNT) {
    // Service account mode — verify the key file actually exists on disk
    if (!existsSync(SERVICE_ACCOUNT_KEY_PATH)) {
      errors.push(
        `GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY points to a file that does not exist: "${SERVICE_ACCOUNT_KEY_PATH}"`
      );
    }
  } else {
    // OAuth2 mode — need client ID + secret at minimum
    if (!OAUTH2.clientId) {
      errors.push(
        'GOOGLE_SHEETS_CLIENT_ID is required when GOOGLE_SHEETS_ENABLED=true ' +
        '(and no service account key is provided)'
      );
    }
    if (!OAUTH2.clientSecret) {
      errors.push(
        'GOOGLE_SHEETS_CLIENT_SECRET is required when GOOGLE_SHEETS_ENABLED=true ' +
        '(and no service account key is provided)'
      );
    }
    if (!OAUTH2.refreshToken) {
      errors.push(
        'GOOGLE_SHEETS_REFRESH_TOKEN is missing. ' +
        'Complete the OAuth2 flow first: GET /api/google-sheets/auth-url → ' +
        'authorise → POST /api/google-sheets/callback → save refresh_token to .env'
      );
    }
  }

  return errors;
};

export default {
  SHEETS_ENABLED,
  USING_SERVICE_ACCOUNT,
  SERVICE_ACCOUNT_KEY_PATH,
  OAUTH2,
  SCOPES,
  validateGoogleSheetsConfig,
};
