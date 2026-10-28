/**
 * =============================================================================
 * businessCode.js
 * =============================================================================
 * Human-facing business codes.
 *
 *   Main business:  <3 letters from the name><4 digits>   e.g. PRO4821
 *   Branch:         <main code>-<sequence>                 e.g. PRO4821-2
 *
 * Codes are generated on the server only. A client never supplies one for a
 * main business. The backfill in drizzle/0030 derives the letter prefix the
 * same way, so existing and new codes look alike.
 * =============================================================================
 */

import { randomInt } from 'node:crypto';

const FALLBACK_PREFIX = 'BIZ';
const DIGIT_COUNT = 4;
export const BUSINESS_CODE_CONSTRAINT = 'businesses_business_code_unique';

/** Up to three letters from the business name, uppercased. */
export function codePrefixFromName(name) {
  const letters = String(name ?? '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return letters || FALLBACK_PREFIX;
}

/** A fresh main code. Uniqueness is enforced by the DB, not by this function. */
export function generateMainCode(name) {
  // 1000-9999 keeps every code exactly 4 digits, as in the spec.
  const digits = randomInt(10 ** (DIGIT_COUNT - 1), 10 ** DIGIT_COUNT);
  return `${codePrefixFromName(name)}${digits}`;
}

export function branchCodeFor(mainCode, sequence) {
  return `${mainCode}-${sequence}`;
}

/** Normalizes user input before lookup: trims and uppercases. */
export function normalizeBusinessCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

/**
 * True when err is a Postgres unique violation. Drizzle wraps the driver
 * error in `cause`, so check both places. Pass a constraint name fragment to
 * tell one unique index from another.
 */
export function isUniqueViolation(err, constraintFragment) {
  const pgErr = err?.cause ?? err;
  if (pgErr?.code !== '23505') return false;
  if (!constraintFragment) return true;
  return String(pgErr.constraint ?? pgErr.message ?? '').includes(constraintFragment);
}
