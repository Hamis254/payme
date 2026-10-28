/**
 * =============================================================================
 * tokenPricing.js: the one place token value is defined.
 * =============================================================================
 * 1 token = KES 2. Tokens are never rounded. KES 25 buys 12.5 tokens.
 *
 * Every token amount is a multiple of 0.5, because purchases are whole KES and
 * the price is 2. Multiples of 0.5 are exact in binary floating point, so
 * balances and sums stay exact as JavaScript numbers.
 *
 * Changing the price is a one-line change here. Nothing else should hard-code 2.
 * =============================================================================
 */

export const TOKEN_PRICE_KES = 2;
export const MIN_CUSTOM_KES = 50;
export const MAX_CUSTOM_KES = 100_000;

/** Tokens for a KES amount. Exact for whole KES, so KES 25 gives 12.5. */
export const kesToTokens = kes => {
  if (typeof kes !== 'number' || !Number.isFinite(kes)) {
    throw new TypeError(`KES amount must be a finite number, got ${kes}`);
  }
  return kes / TOKEN_PRICE_KES;
};

/** KES value of a token amount. KES value of 12.5 tokens is 25. */
export const tokensToKes = tokens => {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) {
    throw new TypeError(`Token amount must be a finite number, got ${tokens}`);
  }
  return tokens * TOKEN_PRICE_KES;
};

/**
 * True when a token amount is a legal ledger amount: positive, and a multiple
 * of 0.5. Anything else would mean a value that can't come from a whole-KES
 * purchase, so it's a bug.
 */
export const isLedgerTokenAmount = tokens =>
  typeof tokens === 'number' &&
  Number.isFinite(tokens) &&
  tokens > 0 &&
  Number.isInteger(tokens * 2);
