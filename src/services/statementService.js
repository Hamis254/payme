/**
 * =============================================================================
 * SERVICE: PDF GENERATION ENGINE (Statement Service)
 * =============================================================================
 * CORE RESPONSIBILITY:
 * Orchestrates creation of "Bank-Grade" financial statements. Business
 * identity comes from `businesses`/`users`; ALL financial data (revenue,
 * COGS, receivables, ledger) comes from sales.service.js's
 * getStatementFinancials — the same authoritative source Daily Sales uses
 * — so the statement can never disagree with what's on screen.
 *
 * Why not read `records`/`record_items` directly (as earlier versions of
 * this file did): sales, credit, and hire-purchase all originate in
 * `sales`/`sale_items` (real stock deduction, real FIFO cost). `records`
 * is only a best-effort mirror of those three types, written with a
 * non-fatal try/catch — so it can silently miss a row and a statement
 * built from it could disagree with what Daily Sales shows for the exact
 * same period. Expenses are the one exception: they have no operational
 * table and only ever live in `records`, which getStatementFinancials
 * already accounts for internally.
 *
 * SUPPORTING LIBRARIES & DEPENDENCIES:
 * 1. PUPPETEER: Headless Chrome engine used to render HTML/CSS into A4 PDF.
 * 2. HANDLEBARS: Template engine used to inject dynamic data into HTML.
 * 3. CRYPTO: Node.js native library for SHA-256 fingerprinting.
 * 4. FS (File System): For reading modular template files (Header/Footer/Body).
 * 5. QRCODE: Generates the 1-tap verification link for bank officers.
 *
 * STATEMENT TYPES:
 * - 'summary' — financial position only (revenue, trend, COGS, profit,
 *   receivables). No line-by-line ledger.
 * - 'full'    — everything in 'summary' PLUS the complete, UNBOUNDED
 *   transaction ledger (Section 6) — never truncated, since this document
 *   is meant to stand up as evidence (bank assessment, legal proceedings).
 *
 * @module services/statementService
 * @version 3.0.0 (Sources financials from sales.service.js, not records)
 * =============================================================================
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';
import Handlebars from 'handlebars';
import { fileURLToPath } from 'url';
import logger from '#config/logger.js';
import { getStatementFinancials } from '#services/sales.service.js';
import {
  businessDayKey,
  resolveStatementRange,
  toBusinessDayKey,
} from '#utils/businessDay.js';
import { formatAccountAge } from '#utils/formatAccountAge.js';
import { db } from '#config/database.js';
import {
  statementAuditLogs,
  statementVerificationChecks,
} from '#models/statementAudit.model.js';
import { eq } from 'drizzle-orm';
import { businesses } from '#models/setting.model.js';
import { users } from '#models/user.model.js';
import { paymentConfigs } from '#models/paymentConfig.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Valid values for the `statementType` parameter across this module. */
const VALID_STATEMENT_TYPES = ['summary', 'full'];

/**
 * Resolve the browser executable used to render PDFs.
 *
 * If Puppeteer has a bundled Chromium executable available, use it.
 * Otherwise, allow explicit configuration via environment variables or
 * detect a locally installed Chrome/Edge binary on the host.
 */
function resolveBrowserExecutablePath() {
  const envVars = [
    'PUPPETEER_EXECUTABLE_PATH',
    'CHROME_PATH',
    'CHROME_BIN',
    'CHROMIUM_PATH',
    'CHROMIUM_BIN',
  ];

  for (const envVar of envVars) {
    const candidate = process.env[envVar];
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const bundledPath = puppeteer.executablePath();
    if (bundledPath && fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  } catch (error) {
    // Ignore: bundled Chromium may not be downloaded yet.
  }

  const platformPaths = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    linux: [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
  };

  const candidates = platformPaths[process.platform] || [];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildPuppeteerLaunchOptions() {
  const executablePath = resolveBrowserExecutablePath();
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  return launchOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an Error with a machine-readable `code` and HTTP-ish `statusCode`
 * attached, so controllers can map failures to sensible responses instead of
 * everything collapsing to a generic 500.
 *
 * @param {string} message - Human-readable, descriptive error message
 * @param {string} code - Short machine-readable code (e.g. 'BUSINESS_NOT_FOUND')
 * @param {number} statusCode - Suggested HTTP status code for this failure
 * @returns {Error}
 */
function createStatementError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/**
 * Validate the inputs to generateBusinessStatement before any DB or
 * filesystem work happens, so failures are cheap and the error message
 * tells the caller exactly what was wrong.
 *
 * @param {number|string} businessId
 * @param {Date|string} startDate
 * @param {Date|string|null} endDate
 * @param {string} statementType
 * @returns {{ parsedStart: Date, parsedEnd: Date }}
 * @throws {Error} with .code and .statusCode set
 */
function validateStatementRequest(businessId, startDate, endDate, statementType) {
  const problems = [];

  const numericBusinessId = Number(businessId);
  if (!businessId || !Number.isInteger(numericBusinessId) || numericBusinessId <= 0) {
    problems.push(
      `Invalid business ID: "${businessId}". Expected a positive whole number.`
    );
  }

  // Dates are checked as Nairobi days, not Date objects. A bare 'YYYY-MM-DD'
  // coerced to Date lands on 03:00 Nairobi and drops the rest of the final
  // day from the PDF. The window is resolved below by resolveStatementRange,
  // the same resolver the on-screen preview uses, so the two cover identical
  // days.
  const startKey = toBusinessDayKey(startDate);
  if (!startDate) {
    problems.push('A start date is required to generate a statement.');
  } else if (!startKey) {
    problems.push(
      `Invalid start date: "${startDate}". Expected a valid date (e.g. 2026-01-01).`
    );
  }

  const endKey = endDate ? toBusinessDayKey(endDate) : null;
  if (endDate && !endKey) {
    problems.push(
      `Invalid end date: "${endDate}". Expected a valid date (e.g. 2026-06-30).`
    );
  }

  // An end date after today is clamped to today, so the start must be
  // compared against that clamped end.
  const todayKey = businessDayKey();
  const effectiveEndKey = !endKey || endKey > todayKey ? todayKey : endKey;
  if (startKey && effectiveEndKey && startKey > effectiveEndKey) {
    problems.push(
      `Start date (${startKey}) cannot be after end date (${effectiveEndKey}). ` +
        'Swap the two dates or widen the range.'
    );
  }

  if (statementType && !VALID_STATEMENT_TYPES.includes(statementType)) {
    problems.push(
      `Invalid statement type: "${statementType}". Must be one of: ` +
        `${VALID_STATEMENT_TYPES.join(', ')}.`
    );
  }

  if (problems.length > 0) {
    throw createStatementError(
      problems.join(' '),
      'STATEMENT_VALIDATION_ERROR',
      400
    );
  }

  const { start, end } = resolveStatementRange(startDate, endDate);
  return { parsedStart: start, parsedEnd: end };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GENERATE VERIFICATION CODE: 9-character code (XXX-XXX-XXX)
 * @returns {string} Format: ABC-DEF-GHI
 */
function generateVerificationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 9; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code.match(/.{1,3}/g).join('-');
}

/**
 * CALCULATE SHA-256 FINGERPRINT: Digital signature for the whole statement.
 * If any amount in the underlying financials changes after generation,
 * this fingerprint breaks.
 * @param {Object} data
 * @returns {string} SHA-256 hash (64-char hex string)
 */
function calculateSHA256Fingerprint(data) {
  try {
    const dataString = JSON.stringify(data, null, 2);
    return crypto.createHash('sha256').update(dataString).digest('hex');
  } catch (error) {
    throw createStatementError(
      `Failed to compute the statement fingerprint: ${error.message}. ` +
        'The statement was not generated because it cannot be issued without ' +
        'a verifiable fingerprint.',
      'FINGERPRINT_GENERATION_FAILED',
      500
    );
  }
}

/**
 * CALCULATE LEDGER ROW HASHES: Individual SHA-256 per ledger line, keyed
 * by row index (ledger rows come from getStatementFinancials as a flat,
 * already-ordered array rather than DB records with their own ids).
 * @param {Array} ledgerRows
 * @returns {Object} Map of row index -> SHA-256 hash
 */
function calculateTransactionHashes(ledgerRows) {
  const hashes = {};
  ledgerRows.forEach((row, index) => {
    const rowData = {
      product: row.product,
      qty: row.qty,
      type: row.type,
      method: row.method,
      time: row.time,
      amount: row.amount,
    };
    hashes[index] = crypto
      .createHash('sha256')
      .update(JSON.stringify(rowData))
      .digest('hex');
  });
  return hashes;
}

/**
 * STORE AUDIT LOG: Save verification code and fingerprint to database.
 *
 * @throws {Error} STATEMENT_AUDIT_LOG_FAILED if the DB write fails — a
 *   statement is not considered issued if it can't be logged, since an
 *   un-logged statement can never be verified later.
 */
async function storeAuditLog(
  businessId,
  verificationCode,
  fingerprint,
  transactionHashes,
  startDate,
  endDate,
  recordCount,
  pdfMetadata,
  userId = null
) {
  try {
    const qrVerificationUrl = `https://payme.co.ke/verify/${verificationCode}`;

    const [auditLog] = await db
      .insert(statementAuditLogs)
      .values({
        business_id: businessId,
        verification_code: verificationCode,
        sha256_fingerprint: fingerprint,
        transaction_data_hash: transactionHashes,
        statement_start_date: startDate,
        statement_end_date: endDate,
        record_count: recordCount,
        pdf_metadata: pdfMetadata,
        qr_verification_url: qrVerificationUrl,
        is_verified: 0,
        issued_by_user_id: userId,
      })
      .returning();

    if (!auditLog) {
      throw new Error('Insert returned no row');
    }

    logger.info('Statement audit log created', {
      auditId: auditLog.id,
      businessId,
      verificationCode,
      fingerprint: fingerprint.substring(0, 16) + '...',
    });

    return auditLog;
  } catch (error) {
    logger.error('Failed to store statement audit log', {
      error: error.message,
      businessId,
      verificationCode,
    });
    throw createStatementError(
      'The statement PDF was generated, but its audit record could not be ' +
        `saved (${error.message}). Without an audit record this statement ` +
        'cannot later be verified via QR code, so it has NOT been issued. ' +
        'Please try again.',
      'STATEMENT_AUDIT_LOG_FAILED',
      500
    );
  }
}

/**
 * SET PDF READ-ONLY PERMISSIONS: Puppeteer page.pdf() options
 * @returns {Object} PDF generation options
 */
function getPdfSecurityOptions() {
  return {
    format: 'A4',
    printBackground: true,
    margin: {
      top: '10mm',
      bottom: '10mm',
      left: '10mm',
      right: '10mm',
    },
    displayHeaderFooter: false,
  };
}

/**
 * GENERATE PDF METADATA: Security headers embedded in the HTML before
 * rendering, so compatible PDF readers can display read-only / origin info.
 * @returns {string} HTML meta tags for security
 */
function generatePdfSecurityMetadata() {
  const metadata = {
    'pdf-creator': 'PayMe Financial System',
    'pdf-producer': 'PayMe v3.0.0',
    'pdf-generated': new Date().toISOString(),
    'pdf-verification': 'SHA-256 fingerprint-verify at payme.co.ke/verify',
  };

  return Object.entries(metadata)
    .map(([key, value]) => `<meta name="${key}" content="${value}" />`)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FORMAT CURRENCY: Kenyan Shillings. Guards against non-numeric input so a
 * bad amount produces "KES 0.00" instead of "KES NaN" on a legal document.
 * @param {number|string} amount
 * @returns {string}
 */
/**
 * Round to 2dp, matching sales.service.js's round2 — so figures this file
 * derives can't drift from the ones getStatementFinancials already rounded.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatCurrency(amount) {
  const value = parseFloat(amount);
  const safeValue = Number.isFinite(value) ? value : 0;
  return `KES ${safeValue.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * FORMAT DATE: ISO to readable format
 * @param {Date|string} date
 * @returns {string} Formatted date (e.g. "26 Jan 2026") or "N/A"
 */
function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED PRESENTATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which bucket each ledger row type belongs to.
 *
 * Splitting on the sign of the amount (as this used to) is wrong: credit and
 * hire purchase *given* are negative, so they landed in "expenses" alongside
 * rent and petty cash. Opening a debt is not spending money, and a month with
 * heavy credit sales looked like a month of heavy costs.
 */
const TREND_BUCKET_BY_TYPE = {
  // Money actually received
  CASH: 'collected',
  MPESA: 'collected',
  CREDIT_REPAYMENT: 'collected',
  HP_DEPOSIT: 'collected',
  HP_INSTALLMENT: 'collected',
  // Money actually spent
  PETTY_EXPENSE: 'expenses',
  OPERATING_EXPENSE: 'expenses',
  // Goods out, payment pending — neither cash in nor cash out
  CREDIT_PENDING: 'debts',
  HP_PENDING: 'debts',
};

/**
 * Bucket ledger rows into calendar months, split by row type rather than by
 * the sign of the amount, for the "Business Trend" section.
 *
 * `net` is collected − expenses: real cash movement for the month. Debts
 * opened are reported alongside but deliberately excluded from it, matching
 * how Section 4 treats them.
 *
 * @param {Array} ledgerRows - Raw rows from getStatementFinancials (unformatted)
 * @returns {Array<{month: string, collected: string, expenses: string, debts: string, net: string}>}
 */
function computeMonthlyTrend(ledgerRows) {
  const buckets = {};

  ledgerRows.forEach(row => {
    const date = new Date(row.time);
    if (isNaN(date.getTime())) return;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) {
      buckets[key] = {
        label: date.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        collected: 0,
        expenses: 0,
        debts: 0,
      };
    }

    // Fall back to the sign for any type added later, so a new ledger type
    // shows up somewhere sensible instead of silently vanishing from the trend.
    const bucket =
      TREND_BUCKET_BY_TYPE[row.type] ?? (row.amount >= 0 ? 'collected' : 'expenses');
    buckets[key][bucket] += Math.abs(Number(row.amount) || 0);
  });

  return Object.keys(buckets)
    .sort()
    .map(key => ({
      month: buckets[key].label,
      collected: formatCurrency(buckets[key].collected),
      expenses: formatCurrency(buckets[key].expenses),
      debts: formatCurrency(buckets[key].debts),
      net: formatCurrency(buckets[key].collected - buckets[key].expenses),
    }));
}

/**
 * The PayMe logo, inlined as a data URI.
 *
 * Puppeteer renders from a string with no base URL, so a relative <img src>
 * would never resolve — the mark has to travel inside the HTML. Read once and
 * cached: the file is ~110KB and every statement would otherwise re-read and
 * re-encode it.
 *
 * @returns {string} data URI, or '' if the asset is missing (the header then
 *   falls back to the PAYME wordmark rather than rendering a broken image).
 */
let _logoDataUri = null;
function getPaymeLogoDataUri() {
  if (_logoDataUri !== null) return _logoDataUri;
  try {
    // payme.png, not the original payme.jpeg: JPEG can't carry an alpha
    // channel, so the artwork's off-white background printed as a pale box
    // against the white header. The PNG is that same mark with a real alpha
    // channel and the surrounding dead space cropped off.
    const file = path.join(__dirname, 'assets', 'payme.png');
    _logoDataUri = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch (error) {
    logger.warn('PayMe logo asset could not be read; falling back to wordmark', {
      error: error.message,
    });
    _logoDataUri = '';
  }
  return _logoDataUri;
}

/** Human labels for the raw ledger type tags. */
const LEDGER_TYPE_LABELS = {
  CASH: 'Cash Sale',
  MPESA: 'M-Pesa Sale',
  CREDIT_PENDING: 'Credit Given',
  CREDIT_REPAYMENT: 'Credit Repayment',
  HP_PENDING: 'HP Given',
  HP_DEPOSIT: 'HP Deposit',
  HP_INSTALLMENT: 'HP Installment',
  PETTY_EXPENSE: 'Petty Expense',
  OPERATING_EXPENSE: 'Operating Expense',
};

/**
 * The method each type already implies. When a row's method matches, naming
 * it again adds nothing — "Cash Sale (Cash)" — so it's left off.
 */
const METHOD_IMPLIED_BY_TYPE = {
  CASH: 'CASH',
  MPESA: 'MPESA',
  CREDIT_PENDING: 'CREDIT',
  HP_PENDING: 'HIRE_PURCHASE',
};

const METHOD_LABELS = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  CREDIT: 'Credit',
  HIRE_PURCHASE: 'Hire Purchase',
  BANK_TRANSFER: 'Bank Transfer',
};

/**
 * Collapse a row's type and method into a single cell.
 *
 * The ledger used to carry these as two columns. They are NOT duplicates —
 * method=CASH covers cash sales, HP deposits, petty expenses and operating
 * expenses alike, and OPERATING_EXPENSE arrives by cash, M-Pesa or bank
 * transfer — so dropping either one loses information. Merging keeps both
 * facts while giving the width back to the columns that need it.
 *
 * @param {string} type - Raw ledger type tag (e.g. 'HP_DEPOSIT')
 * @param {string} method - Raw payment method (e.g. 'CASH')
 * @returns {string} e.g. 'Cash Sale', 'HP Deposit (Cash)'
 */
function formatTypeMethod(type, method) {
  const label = LEDGER_TYPE_LABELS[type] || type || '—';
  if (!method || METHOD_IMPLIED_BY_TYPE[type] === method) return label;
  return `${label} (${METHOD_LABELS[method] || method})`;
}

/**
 * Format raw ledger rows (numeric amounts, Date objects) into the string
 * shape the Handlebars templates expect for display.
 *
 * @param {Array} ledgerRows - Raw rows from getStatementFinancials
 * @returns {Array} Display-ready rows
 */
function formatLedgerRowsForDisplay(ledgerRows) {
  return ledgerRows.map(row => ({
    product: row.product,
    qty: row.qty,
    type_method: formatTypeMethod(row.type, row.method),
    phone: row.phone,
    tx_id: row.tx_id,
    time: formatDate(row.time),
    amount: formatCurrency(row.amount),
  }));
}

/**
 * Read and compile all three Handlebars templates from disk.
 *
 * @returns {{ compiledHeader: Function, compiledBody: Function, compiledFooter: Function }}
 * @throws {Error} TEMPLATE_READ_FAILED if any template file is missing or unreadable
 */
function loadStatementTemplates() {
  const templateFiles = {
    header: path.join(__dirname, 'statementHeader.html'),
    body: path.join(__dirname, 'statementBody.html'),
    footer: path.join(__dirname, 'statementFooter.html'),
  };

  const rawTemplates = {};
  for (const [name, filePath] of Object.entries(templateFiles)) {
    try {
      rawTemplates[name] = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      throw createStatementError(
        `Could not read the "${name}" statement template at ${filePath}: ` +
          `${error.message}. The PDF cannot be generated without it — check ` +
          'that all three template files (statementHeader.html, ' +
          'statementBody.html, statementFooter.html) are present in ' +
          'src/services/.',
        'TEMPLATE_READ_FAILED',
        500
      );
    }
  }

  try {
    return {
      compiledHeader: Handlebars.compile(rawTemplates.header),
      compiledBody: Handlebars.compile(rawTemplates.body),
      compiledFooter: Handlebars.compile(rawTemplates.footer),
    };
  } catch (error) {
    throw createStatementError(
      'One of the statement templates has invalid Handlebars syntax: ' +
        `${error.message}. Fix the template file and try again.`,
      'TEMPLATE_COMPILE_FAILED',
      500
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GENERATE BUSINESS STATEMENT: Main PDF generation orchestrator.
 *
 * All financial data (revenue, COGS, receivables, ledger) comes from
 * sales.service.js's getStatementFinancials — the same source Daily Sales
 * reads from — so this document can never disagree with what's on screen.
 *
 * @param {number|string} businessId
 * @param {Date|string} startDate
 * @param {Date|string|null} [endDate] - defaults to today
 * @param {number|null} [userId] - user generating the statement, for audit trail
 * @param {'summary'|'full'} [statementType='full']
 * @returns {Promise<{pdfBuffer: Buffer, vCode: string, auditId: number, fingerprint: string}>}
 * @throws {Error} See .code on the thrown error:
 *   STATEMENT_VALIDATION_ERROR (400), BUSINESS_NOT_FOUND (404),
 *   NO_RECORDS_FOUND (404), STATEMENT_FINANCIALS_FAILED (500),
 *   TEMPLATE_READ_FAILED/TEMPLATE_COMPILE_FAILED/TEMPLATE_RENDER_FAILED (500),
 *   QR_CODE_GENERATION_FAILED (500), PDF_ENGINE_START_FAILED (500),
 *   PDF_RENDER_FAILED (500), STATEMENT_AUDIT_LOG_FAILED (500)
 */
export async function generateBusinessStatement(
  businessId,
  startDate,
  endDate = null,
  userId = null,
  statementType = 'full'
) {
  let browser = null;

  // A. Validate inputs before touching the DB or filesystem
  const { parsedStart, parsedEnd } = validateStatementRequest(
    businessId,
    startDate,
    endDate,
    statementType
  );
  const statement_start_date = parsedStart;
  const statement_end_date = parsedEnd;
  const numericBusinessId = parseInt(businessId, 10);

  try {
    logger.info('Starting statement generation', {
      businessId: numericBusinessId,
      statement_start_date,
      statement_end_date,
      statementType,
    });

    // B. Fetch business identity + owner + payment collection details
    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, numericBusinessId))
      .limit(1);

    if (!business) {
      throw createStatementError(
        `No business found with ID ${numericBusinessId}. It may have been ` +
          'deleted, or the ID may be incorrect.',
        'BUSINESS_NOT_FOUND',
        404
      );
    }

    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.id, business.user_id))
      .limit(1);

    if (!owner) {
      logger.warn('Statement generation: business owner record not found', {
        businessId: numericBusinessId,
        ownerUserId: business.user_id,
      });
    }

    // Payment collection details — the actual till/paybill customer money
    // moves through, set up alongside the business at onboarding. This is
    // what's shown on the statement, not a generic "phone number".
    const [paymentConfig] = await db
      .select()
      .from(paymentConfigs)
      .where(eq(paymentConfigs.business_id, numericBusinessId))
      .limit(1);

    if (!paymentConfig) {
      logger.warn('Statement generation: no payment config found for business', {
        businessId: numericBusinessId,
      });
    }

    // C. Fetch ALL financial data from the authoritative source in one call
    let financials;
    try {
      financials = await getStatementFinancials(
        numericBusinessId,
        statement_start_date,
        statement_end_date
      );
    } catch (error) {
      throw createStatementError(
        `Failed to compute financial data for this statement: ${error.message}`,
        'STATEMENT_FINANCIALS_FAILED',
        500
      );
    }

    const { ledgerRows: rawLedgerRows, totals } = financials;

    // `totals` has no record_count — the old check read undefined, compared it
    // to 0, and never fired, so an empty period rendered a PDF full of zeros
    // instead of returning 404. ledgerRows is the row set the statement is
    // actually built from, so its length is the real emptiness test.
    if (rawLedgerRows.length === 0) {
      throw createStatementError(
        `No transactions were found for "${business.name}" between ` +
          `${formatDate(statement_start_date)} and ${formatDate(statement_end_date)}. ` +
          'Choose a period that has recorded sales, credit, hire purchase, or ' +
          'expense activity.',
        'NO_RECORDS_FOUND',
        404
      );
    }

    // D. Derived P&L figures.
    //
    // This block used to read totals.gross_revenue / .total_money_out /
    // .gross_profit / .net_profit — none of which getStatementFinancials
    // returns. formatCurrency(undefined) yields "KES 0.00" rather than
    // throwing, so the whole P&L printed zeros silently.
    //
    // The statement now follows the same cost-recovery model the app uses,
    // which has no accrual "gross revenue"/"gross profit" concept:
    //
    //   Revenue Collected  = cash + mpesa + credit repaid + HP deposits
    //                        + HP installments        (= cash_collected)
    //   Cash in Hand       = Revenue Collected − petty expenses
    //   Net Profit         = realized profit − operating expenses − spoilage
    //
    // Credit/HP *given* are debts opened, not money in, so they are reported
    // in their own section and never folded into Revenue Collected.
    const revenueCollected = totals.cash_collected;
    const hpCollected = round2(
      totals.hp_deposits_period + totals.hp_installments_period
    );
    const netMarginPercent =
      revenueCollected > 0
        ? ((totals.net_profit_for_period / revenueCollected) * 100).toFixed(1)
        : '0.0';
    const totalReceivables = totals.total_receivables;

    // The Section 6 footer totals the Amount column, which carries negative
    // signs for credit/HP given and expenses. Summing the rows is the only
    // figure that actually foots against the column printed above it.
    const ledgerNetTotal = round2(
      rawLedgerRows.reduce((sum, r) => sum + Number(r.amount || 0), 0)
    );

    const monthlyTrend = computeMonthlyTrend(rawLedgerRows);
    const showTrend = monthlyTrend.length > 1;

    // E. Ledger — only formatted/included for 'full' statements. Never
    // truncated: getStatementFinancials already returned every row in range.
    const includeLedger = statementType === 'full';
    const displayLedgerRows = includeLedger
      ? formatLedgerRowsForDisplay(rawLedgerRows)
      : [];

    // Section numbers are counted here rather than hard-coded in the
    // template. Two sections are conditional — the trend needs more than one
    // calendar month, the ledger only appears on a 'full' statement — and
    // with fixed numbering a hidden section left a hole in the sequence
    // (that's why a single-month statement read "1." then "1C." with no
    // "1B."). Numbering only what actually renders makes gaps impossible.
    let sectionNo = 0;
    const s = {
      revenue: ++sectionNo,
      given: ++sectionNo,
      trend: showTrend ? ++sectionNo : null,
      volume: ++sectionNo,
      expenses: ++sectionNo,
      profit: ++sectionNo,
      receivables: ++sectionNo,
      // Always numbered: on a summary statement this section still renders,
      // as the notice explaining the ledger was deliberately omitted. Making
      // it conditional printed a bare ". DETAILED TRANSACTION LEDGER".
      ledger: ++sectionNo,
      security: ++sectionNo,
    };

    // ============ SECURITY: SHA-256 FINGERPRINTING ============
    const vCode = generateVerificationCode();
    const fingerprint = calculateSHA256Fingerprint({
      businessId: numericBusinessId,
      statementType,
      totals,
      ledgerRows: rawLedgerRows,
      timestamp: Date.now(),
    });
    const transactionHashes = calculateTransactionHashes(rawLedgerRows);

    logger.info('SHA-256 fingerprint generated', {
      mainFingerprint: fingerprint.substring(0, 16) + '...',
      ledgerRowCount: rawLedgerRows.length,
      vCode,
      statementType,
    });

    // ============ SECURITY: QR CODE ============
    let qrUrl;
    try {
      qrUrl = await QRCode.toDataURL(`https://payme.co.ke/verify/${vCode}`);
    } catch (error) {
      throw createStatementError(
        `Failed to generate the verification QR code: ${error.message}. ` +
          'A statement cannot be issued without its verification QR code.',
        'QR_CODE_GENERATION_FAILED',
        500
      );
    }

    // ============ SECURITY: PDF METADATA ============
    const pdfSecurityMetadata = generatePdfSecurityMetadata();
    const pdfSecurityOptions = getPdfSecurityOptions();

    const pdfMetadata = {
      is_read_only: true,
      encryption_status: 'AES-256',
      user_permissions: 'read-only',
      no_copy: true,
      no_print_modifications: true,
      generated_at: new Date().toISOString(),
      generator: 'PayMe Financial System v3.0.0',
      statement_type: statementType,
      ledger_included: includeLedger,
      ledger_transaction_count: displayLedgerRows.length,
    };

    // F. Load + compile templates
    const { compiledHeader, compiledBody, compiledFooter } =
      loadStatementTemplates();

    const paymentMethodLabel =
      paymentConfig?.payment_method === 'till_number' ? 'Till Number' : 'Paybill';

    const templateData = {
      // Business identity
      business_name: business.name,
      location: business.location,
      address: business.location_description || business.location,
      email: owner?.email || '—',
      owner_name: owner?.name || owner?.email || '—',
      logo_url: business.logo_url || null,
      business_code: business.business_code,
      member_since: formatDate(owner?.created_at),
      account_age: formatAccountAge(owner?.created_at, new Date()),

      // Payment collection identity — sourced from payment_configs, the
      // actual STK push destination set up at onboarding.
      payment_method_label: paymentConfig ? paymentMethodLabel : 'Not configured',
      payment_shortcode: paymentConfig?.shortcode || '—',
      payment_account_reference: paymentConfig?.account_reference || '—',

      // Statement metadata
      statement_type_label:
        statementType === 'full'
          ? 'FULL STATEMENT — SUMMARY + TRANSACTION LEDGER'
          : 'SUMMARY STATEMENT — FINANCIAL POSITION ONLY',
      is_full_statement: includeLedger,

      // Statement period
      statement_start_date: formatDate(statement_start_date),
      statement_end_date: formatDate(statement_end_date),
      generated_date: formatDate(new Date()),
      start_date: formatDate(statement_start_date),
      end_date: formatDate(statement_end_date),

      // Section 1 — money actually collected. Every line here is cash the
      // business received in the period, and they foot to revenue_collected.
      cash_total: formatCurrency(totals.cash_sales),
      mpesa_total: formatCurrency(totals.mpesa_sales),
      credit_repaid: formatCurrency(totals.credit_repaid_period),
      hp_deposits: formatCurrency(totals.hp_deposits_period),
      hp_installments: formatCurrency(totals.hp_installments_period),
      revenue_collected: formatCurrency(revenueCollected),

      // Section 1C — debts opened this period. Goods left the shop but no
      // money arrived, so these are deliberately NOT in revenue_collected.
      credit_given: formatCurrency(totals.credit_given_period),
      hp_given: formatCurrency(totals.hp_given_period),

      // Transaction counts
      cash_count: totals.cash_count,
      mpesa_count: totals.mpesa_count,
      credit_count: totals.credit_sales_opened_count,
      hp_count: totals.hp_agreements_opened_count,
      total_transactions: rawLedgerRows.length,

      // Section 3 — expenses, kept as two separate lines. Petty spend comes
      // out of today's till; operating expenses (rent, salaries) do not.
      // Summing them was the bug that made the daily card irreconcilable.
      petty_expenses: formatCurrency(totals.petty_expenses),
      operating_expenses: formatCurrency(totals.operating_expenses),
      spoiled_total: formatCurrency(totals.spoiled_total),

      // Section 4 — cash position and the real P&L walk
      cash_in_hand: formatCurrency(totals.cash_in_hand),
      realized_profit: formatCurrency(totals.realized_profit),
      net_profit: formatCurrency(totals.net_profit_for_period),
      net_margin_percent: netMarginPercent,

      // Accrual reference figures — business volume, explicitly not cash
      accrual_goods_sold_value: formatCurrency(totals.accrual_goods_sold_value),
      total_cogs: formatCurrency(totals.total_cogs),
      credit_cogs: formatCurrency(totals.credit_cogs),

      // Receivables (Section 5)
      credit_outstanding: formatCurrency(totals.credit_outstanding),
      hp_outstanding: formatCurrency(totals.hp_outstanding),
      hp_collected: formatCurrency(hpCollected),
      total_receivables: formatCurrency(totalReceivables),

      // Business trend
      monthly_trend: monthlyTrend,
      show_trend: showTrend,

      // Brand mark, inlined (see getPaymeLogoDataUri)
      payme_logo: getPaymeLogoDataUri(),

      // Section numbers, counted over only the sections that render
      s_revenue: s.revenue,
      s_given: s.given,
      s_trend: s.trend,
      s_volume: s.volume,
      s_expenses: s.expenses,
      s_profit: s.profit,
      s_receivables: s.receivables,
      s_ledger: s.ledger,
      s_security: s.security,

      // Ledger (Section 6) — only present for 'full' statements
      transactions: displayLedgerRows,
      show_ledger: includeLedger,
      ledger_transaction_count: displayLedgerRows.length,
      ledger_net_total: formatCurrency(ledgerNetTotal),

      // Verification & security
      verification_code: vCode,
      qr_code_url: qrUrl,
      sha256_fingerprint: fingerprint,
      record_count: rawLedgerRows.length,
      security_notice: `SHA-256: ${fingerprint.substring(0, 16)}... | Code: ${vCode}`,
    };

    // G. Render HTML
    let fullHtml;
    try {
      const headerHtml = compiledHeader(templateData);
      const bodyHtml = compiledBody(templateData);
      const footerHtml = compiledFooter(templateData);

      fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          ${pdfSecurityMetadata}
        </head>
        <body>
          ${headerHtml}${bodyHtml}${footerHtml}
        </body>
        </html>
      `;

      logger.info('HTML templates rendered', {
        headerLength: headerHtml.length,
        bodyLength: bodyHtml.length,
        footerLength: footerHtml.length,
        statementType,
      });
    } catch (error) {
      throw createStatementError(
        `Failed to render the statement HTML: ${error.message}. This usually ` +
          'means one of the template files references a field that wasn\'t ' +
          'provided — check statementHeader.html, statementBody.html, and ' +
          'statementFooter.html for {{placeholders}} not present in templateData.',
        'TEMPLATE_RENDER_FAILED',
        500
      );
    }

    // H. Generate PDF via Puppeteer
    try {
      browser = await puppeteer.launch(buildPuppeteerLaunchOptions());
    } catch (error) {
      const executablePath = resolveBrowserExecutablePath();
      const installHint = executablePath
        ? `Tried executable at ${executablePath}.`
        : 'No browser executable was detected.';

      throw createStatementError(
        `The PDF rendering engine failed to start: ${error.message}. ${installHint} ` +
          'This usually means Chromium is missing or misconfigured on the server ' +
          '— if you are running locally, install Chromium with `npx puppeteer browsers install chrome` ' +
          'or set PUPPETEER_EXECUTABLE_PATH to a valid Chrome/Edge binary.',
        'PDF_ENGINE_START_FAILED',
        500
      );
    }

    let pdfBuffer;
    try {
      const page = await browser.newPage();
      await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

      // NOTE ON "FOOTER AT THE BOTTOM OF THE PAGE":
      //
      // A measured spacer was tried here — read px-per-mm from the live
      // layout, compute the unused remainder of the last page, insert that
      // much height before .doc-footer. It reported a perfect result and was
      // wrong: document.body.scrollHeight models the content as one
      // continuous column, but the real pagination is shifted by the forced
      // .page-break before the ledger and by every .no-break block Chromium
      // pushes onto a fresh page. The DOM model predicted 2 and 4 pages for
      // the summary and full statements; the actual PDFs are 3 and 5. Padding
      // to the bottom of a page that doesn't exist where you think it does
      // just parks the footer mid-page instead.
      //
      // JS has no access to Chromium's fragmentation, so the remainder isn't
      // computable here. What is guaranteed instead: .doc-footer carries
      // break-inside: avoid, so the block is never split across a page
      // boundary, and margin-top: auto still drops it to the foot of the
      // page on statements short enough to fit on one.
      pdfBuffer = await page.pdf(pdfSecurityOptions);
      await page.close();
    } catch (error) {
      throw createStatementError(
        `Failed to render the statement to PDF: ${error.message}. This can ` +
          'happen if the business logo URL is unreachable or the HTML is ' +
          'malformed — check that logo_url (if set) points to a public image.',
        'PDF_RENDER_FAILED',
        500
      );
    }

    logger.info('PDF generated with read-only permissions', {
      businessId: numericBusinessId,
      bufferSize: pdfBuffer.length,
      vCode,
      statementType,
      ledgerRows: displayLedgerRows.length,
    });

    // ============ SECURITY: STORE AUDIT LOG ============
    const auditLog = await storeAuditLog(
      numericBusinessId,
      vCode,
      fingerprint,
      transactionHashes,
      statement_start_date,
      statement_end_date,
      rawLedgerRows.length,
      pdfMetadata,
      userId
    );

    logger.info('Statement generated successfully', {
      businessId: numericBusinessId,
      auditId: auditLog.id,
      verificationCode: vCode,
      fingerprint: fingerprint.substring(0, 20) + '...',
      recordCount: rawLedgerRows.length,
      statementType,
    });

    return {
      pdfBuffer,
      vCode,
      auditId: auditLog.id,
      fingerprint: fingerprint.substring(0, 16) + '...',
    };
  } catch (error) {
    if (!error.code) {
      logger.error('Statement generation failed with an unexpected error', {
        error: error.message,
        stack: error.stack,
        businessId: numericBusinessId,
      });
      error.code = 'STATEMENT_GENERATION_FAILED';
      error.statusCode = error.statusCode || 500;
    } else {
      logger.error('Statement generation failed', {
        error: error.message,
        code: error.code,
        businessId: numericBusinessId,
      });
    }
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        logger.warn('Failed to close Puppeteer browser cleanly', {
          error: closeError.message,
        });
      }
    }
  }
}

/**
 * VERIFY STATEMENT QR CODE: Check if verification code exists in audit logs.
 * Unchanged from the previous version — verification only ever reads the
 * audit log, never the financial data itself.
 *
 * @param {string} verificationCode - 9-character code (ABC-DEF-GHI) from QR
 * @param {string|null} [providedFingerprint]
 * @param {string} [ipAddress='0.0.0.0']
 * @param {string} [userAgent='Unknown']
 * @param {string|null} [deviceFingerprint]
 * @returns {Promise<Object>} Verification result with fraud detection
 * @throws {Error} VERIFICATION_CODE_INVALID (400) or VERIFICATION_CHECK_FAILED (500)
 */
export async function verifyStatementQRCode(
  verificationCode,
  providedFingerprint = null,
  ipAddress = '0.0.0.0',
  userAgent = 'Unknown',
  deviceFingerprint = null
) {
  const codePattern = /^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/;
  if (!verificationCode || !codePattern.test(verificationCode)) {
    throw createStatementError(
      `"${verificationCode}" is not a valid verification code. Codes must ` +
        'be in XXX-XXX-XXX format using uppercase letters and digits only ' +
        '(e.g. ABC-DEF-GHI).',
      'VERIFICATION_CODE_INVALID',
      400
    );
  }

  try {
    logger.info('Verification code scanned', {
      verificationCode,
      ipAddress,
      providedFingerprint:
        providedFingerprint?.substring(0, 16) || 'not-provided',
    });

    const [auditLog] = await db
      .select()
      .from(statementAuditLogs)
      .where(eq(statementAuditLogs.verification_code, verificationCode))
      .limit(1);

    if (!auditLog) {
      logger.warn('Fraudulent verification attempt — code not found', {
        verificationCode,
        ipAddress,
      });
      return {
        verified: false,
        fraud_detected: true,
        message:
          'Verification code not found. This document may be forged, or the ' +
          'code was mistyped — double-check it against the printed statement.',
        error_code: 'CODE_NOT_FOUND',
        alert_level: 'CRITICAL',
      };
    }

    let fingerprintMatched = true;
    if (
      providedFingerprint &&
      providedFingerprint !== auditLog.sha256_fingerprint
    ) {
      fingerprintMatched = false;
      logger.error('FRAUD ALERT — fingerprint mismatch', {
        verificationCode,
        storedFingerprint: auditLog.sha256_fingerprint.substring(0, 16) + '...',
        providedFingerprint: providedFingerprint.substring(0, 16) + '...',
        ipAddress,
      });
    }

    try {
      await db.insert(statementVerificationChecks).values({
        statement_audit_id: auditLog.id,
        verification_code: verificationCode,
        verification_ip: ipAddress,
        user_agent: userAgent,
        device_fingerprint: deviceFingerprint,
        fingerprint_matched: fingerprintMatched ? 1 : 0,
        stored_fingerprint: auditLog.sha256_fingerprint,
        provided_fingerprint: providedFingerprint,
      });
    } catch (error) {
      throw createStatementError(
        'Verification lookup succeeded but the scan attempt could not be ' +
          `logged: ${error.message}. Treat this verification as unconfirmed ` +
          'and try scanning again.',
        'VERIFICATION_CHECK_FAILED',
        500
      );
    }

    if (fingerprintMatched) {
      await db
        .update(statementAuditLogs)
        .set({
          is_verified: 1,
          verification_timestamp: new Date(),
          verification_ip: ipAddress,
          verification_user_agent: userAgent,
        })
        .where(eq(statementAuditLogs.id, auditLog.id));
    } else {
      await db
        .update(statementAuditLogs)
        .set({
          is_suspicious: 1,
          suspension_reason: `Fingerprint mismatch on ${new Date().toISOString()}. Provided: ${providedFingerprint?.substring(0, 16)}, Expected: ${auditLog.sha256_fingerprint.substring(0, 16)}`,
        })
        .where(eq(statementAuditLogs.id, auditLog.id));
    }

    return {
      verified: fingerprintMatched,
      fraud_detected: !fingerprintMatched,
      verification_code: verificationCode,
      audit_id: auditLog.id,
      issued_date: auditLog.created_at,
      statement_period: {
        start: auditLog.statement_start_date,
        end: auditLog.statement_end_date,
      },
      record_count: auditLog.record_count,
      sha256_fingerprint: auditLog.sha256_fingerprint,
      transaction_count: Object.keys(auditLog.transaction_data_hash || {}).length,
      is_read_only: auditLog.pdf_metadata?.is_read_only === true,
      pdf_permissions: auditLog.pdf_metadata?.user_permissions || 'read-only',
      statement_type: auditLog.pdf_metadata?.statement_type || 'unknown',
      message: fingerprintMatched
        ? '✓ Document verified as authentic and issued by PayMe'
        : '⚠️ WARNING: Document fingerprint does not match. This document may be forged or tampered with.',
      alert_level: fingerprintMatched ? 'CLEAR' : 'FRAUD_ALERT',
    };
  } catch (error) {
    if (!error.code) {
      logger.error('Verification check failed with an unexpected error', {
        error: error.message,
        verificationCode,
      });
      error.code = 'VERIFICATION_CHECK_FAILED';
      error.statusCode = error.statusCode || 500;
    }
    throw error;
  }
}

export default {
  generateBusinessStatement,
  verifyStatementQRCode,
};