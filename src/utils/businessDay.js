/**
 * =============================================================================
 * businessDay.js
 * =============================================================================
 * One home for "what does a day mean to this business".
 *
 * Every reporting window in the app is a calendar range typed by a shop owner
 * in Nairobi — "1st to 20th" means midnight-to-midnight local, not UTC. But
 * `new Date('2026-07-20')` parses as UTC midnight, which is 03:00 in Nairobi.
 * Used as a range end that silently discards the last 21 hours of the final
 * day; used as a range start it silently discards the first 3 hours of the
 * first day.
 *
 * That was a real, measured loss: a 2026-07-01 → 2026-07-20 statement came
 * back with 26 ledger rows and KES 6,570 cash-in-hand, when the correct
 * Nairobi window contains 38 rows and KES 25,040. The whole last trading day
 * was missing from both the on-screen preview and the downloaded PDF.
 *
 * Kenya is permanently UTC+3 (EAT) and has never observed DST, so the fixed
 * +03:00 offset below is safe. If this app ever serves a DST region, this is
 * the single place that has to change.
 * =============================================================================
 */

export const NAIROBI_TZ = 'Africa/Nairobi';
const NAIROBI_OFFSET = '+03:00';

/** Matches a bare calendar date, e.g. '2026-07-20'. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The 'YYYY-MM-DD' key for a moment, as seen in Nairobi.
 * `en-CA` is used because it formats as YYYY-MM-DD.
 */
export function businessDayKey(date = new Date()) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: NAIROBI_TZ });
}

/**
 * Start of a business day — 00:00:00.000 Nairobi.
 *
 * A bare 'YYYY-MM-DD' is anchored to Nairobi midnight. Anything already
 * carrying a time (a Date, or a full ISO string) is passed through untouched,
 * so callers that genuinely mean an instant aren't silently re-interpreted.
 *
 * @param {string|Date|null|undefined} value
 * @returns {Date|null} null when value is null/undefined
 */
export function startOfBusinessDay(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    return new Date(`${value}T00:00:00.000${NAIROBI_OFFSET}`);
  }
  return new Date(value);
}

/**
 * End of a business day — 23:59:59.999 Nairobi, inclusive.
 *
 * Midnight opens the next day, so the boundary is the last representable
 * millisecond before it rather than the next day's 00:00.
 *
 * @param {string|Date|null|undefined} value
 * @returns {Date|null} null when value is null/undefined
 */
export function endOfBusinessDay(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    return new Date(`${value}T23:59:59.999${NAIROBI_OFFSET}`);
  }
  return new Date(value);
}

/**
 * Both edges of a single Nairobi day, for the daily views.
 * @param {string|Date} [value] defaults to today in Nairobi
 */
export function businessDayRange(value) {
  const key = typeof value === 'string' && DATE_ONLY.test(value)
    ? value
    : businessDayKey(value ?? new Date());

  return { dayKey: key, dayStart: startOfBusinessDay(key), dayEnd: endOfBusinessDay(key) };
}
