/**
 * =============================================================================
 * UTIL: JWT
 * =============================================================================
 *
 * Two token types, two secrets, short lifetimes:
 *
 *   Access token  — 15 minutes, signed with JWT_SECRET
 *                   Stateless: verified by middleware with no DB query.
 *
 *   Refresh token — NOT a JWT.  It is a 64-byte cryptographically random
 *                   hex string.  Its validity is proven by finding its
 *                   SHA-256 hash in the refresh_tokens table.
 *                   Using a random string (not a JWT) for the refresh token
 *                   means there is no embedded expiry that an attacker can
 *                   inspect or manipulate, and revocation is instant.
 *
 * The fallback secret string has been removed.  server.js already calls
 * process.exit(1) if JWT_SECRET is missing — the fallback was dead code
 * that only served as a risk if the repo was ever leaked.
 *
 * @module utils/jwt
 * =============================================================================
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import logger from '#config/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const JWT_SECRET       = process.env.JWT_SECRET;       // required — validated in server.js
const ACCESS_TOKEN_TTL = '15m';                        // short-lived
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms (used for cookie + DB)

// ─────────────────────────────────────────────────────────────────────────────
// ACCESS TOKEN  (JWT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign a 15-minute access token.
 *
 * @param {{ id: number, name: string, role: string }} payload
 * @returns {string} signed JWT
 */
const signAccessToken = payload => {
  try {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  } catch (e) {
    logger.error('Failed to sign access token', { error: e.message });
    throw new Error('Failed to sign access token');
  }
};

/**
 * Verify an access token.
 * Throws distinct errors so the middleware can distinguish expired vs invalid.
 *
 * @param {string} token
 * @returns {{ id: number, name: string, role: string, iat: number, exp: number }}
 * @throws {{ name: 'TokenExpiredError' }}  when token is valid but expired
 * @throws {{ name: 'JsonWebTokenError' }}  when token is malformed or tampered
 */
const verifyAccessToken = token => {
  // Let the underlying jwt errors propagate as-is so the middleware can
  // inspect error.name ('TokenExpiredError' vs 'JsonWebTokenError').
  return jwt.verify(token, JWT_SECRET);
};

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH TOKEN  (random hex — NOT a JWT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a new raw refresh token (64 random bytes = 128 hex chars).
 * This value is sent to the client in a cookie.  Only its hash is stored in DB.
 *
 * @returns {string} 128-character hex string
 */
const generateRefreshToken = () => crypto.randomBytes(64).toString('hex');

/**
 * Hash a raw refresh token for storage / lookup.
 * SHA-256 is appropriate here: the input has 512 bits of entropy so
 * pre-image attacks are computationally infeasible.
 *
 * @param {string} rawToken
 * @returns {string} 64-character hex SHA-256 hash
 */
const hashRefreshToken = rawToken =>
  crypto.createHash('sha256').update(rawToken).digest('hex');

/**
 * Returns the refresh token expiry Date object (7 days from now).
 * Used for both the DB row and the cookie maxAge.
 *
 * @returns {Date}
 */
const refreshTokenExpiresAt = () => new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

// Named export kept as `jwttoken` to not break any existing import
export const jwttoken = {
  // Access token
  sign:   signAccessToken,   // backward-compatible name
  verify: verifyAccessToken, // now throws typed errors, not a generic wrapper

  // Refresh token helpers
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  REFRESH_TOKEN_TTL_MS,
};

export default jwttoken;