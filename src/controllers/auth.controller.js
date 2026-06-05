/**
 * =============================================================================
 * CONTROLLER: AUTH
 * =============================================================================
 *
 * Endpoints:
 *   POST /api/auth/sign-up      — register + issue token pair
 *   POST /api/auth/sign-in      — authenticate + issue token pair
 *   POST /api/auth/refresh      — rotate refresh token, issue new access token
 *   POST /api/auth/sign-out     — revoke current refresh token, clear cookies
 *   POST /api/auth/sign-out-all — revoke all refresh tokens for user (all devices)
 *
 * TOKEN PAIR HELPER
 * ──────────────────
 * issueTokenPair() is the single place where both cookies are set.
 * Called from signup, signIn, and refresh — never duplicated.
 *
 * @module controllers/auth
 * =============================================================================
 */

import logger from '#config/logger.js';
import { signupSchema, signInSchema } from '#validations/auth.validation.js';
import { formatValidationError } from '#utils/format.js';
import {
  createUser,
  authenticateUser,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from '#services/auth.service.js';
import { jwttoken } from '#utils/jwt.js';
import { cookies } from '#utils/cookies.js';

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mint a fresh access + refresh token pair for a user and set both cookies.
 * Called identically from signup, signIn, and refresh.
 *
 * @param {Object} res          - Express response object
 * @param {{ id: number, name: string, role: string }} user
 * @param {string|null} [deviceHint]  - from User-Agent (for session display)
 * @param {string|null} [familyId]    - provided on rotation only
 * @returns {Promise<void>}
 */
const issueTokenPair = async (res, user, deviceHint = null, familyId = null) => {
  // Access token — short-lived JWT (15 min)
  const accessToken = jwttoken.sign({
    id:   user.id,
    name: user.name,
    role: user.role,
  });

  // Refresh token — random hex, stored as hash in DB (7 days)
  const { rawToken: refreshToken } = await issueRefreshToken(
    user.id,
    deviceHint,
    familyId
  );

  cookies.setAccessToken(res, accessToken);
  cookies.setRefreshToken(res, refreshToken);
};

/**
 * Extract a coarse device hint from the User-Agent string.
 * Stored for "active sessions" display — not used for auth logic.
 *
 * @param {string} [ua] - req.get('User-Agent')
 * @returns {string}
 */
const extractDeviceHint = ua => {
  if (!ua) return 'Unknown device';
  if (ua.includes('Android'))     return 'Android';
  if (ua.includes('iPhone'))      return 'iPhone';
  if (ua.includes('iPad'))        return 'iPad';
  if (ua.includes('Windows'))     return 'Windows';
  if (ua.includes('Macintosh'))   return 'Mac';
  if (ua.includes('Linux'))       return 'Linux';
  return ua.substring(0, 40);
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGN UP
// ─────────────────────────────────────────────────────────────────────────────

export const signup = async (req, res, next) => {
  try {
    const validationResult = signupSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error:   'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { name, phone_number, password, role } = validationResult.data;
    const user = await createUser({ name, phone_number, password, role });

    await issueTokenPair(res, user, extractDeviceHint(req.get('User-Agent')));

    logger.info('User registered', { userId: user.id, name: user.name });

    return res.status(201).json({
      message:     'User registered successfully',
      setupNeeded: true,
      setup_steps: [
        { step: 1, title: 'Create your business',            endpoint: 'POST /api/businesses',          required: true  },
        { step: 2, title: 'Configure M-Pesa payment method', endpoint: 'POST /api/payment-config/setup', required: true  },
        { step: 3, title: 'Add your stock',                  endpoint: 'POST /api/stock/products',       required: false },
      ],
      user: {
        id:           user.id,
        name:         user.name,
        phone_number: user.phone_number,
        email:        user.email,
        role:         user.role,
      },
    });
  } catch (e) {
    if (e.message === 'User with this name already exists')
      return res.status(409).json({ error: 'Name already taken' });
    if (e.message === 'User with this phone number already exists')
      return res.status(409).json({ error: 'Phone number already registered' });
    logger.error('Signup error', { error: e.message });
    next(e);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGN IN
// ─────────────────────────────────────────────────────────────────────────────

export const signIn = async (req, res, next) => {
  try {
    const validationResult = signInSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error:   'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { name, password } = validationResult.data;
    const user = await authenticateUser({ name, password });

    await issueTokenPair(res, user, extractDeviceHint(req.get('User-Agent')));

    logger.info('User signed in', { userId: user.id });

    return res.status(200).json({
      message: 'Signed in successfully',
      user: {
        id:           user.id,
        name:         user.name,
        phone_number: user.phone_number,
        email:        user.email,
        role:         user.role,
      },
    });
  } catch (e) {
    if (e.message === 'User not found' || e.message === 'Invalid password')
      return res.status(401).json({ error: 'Invalid credentials' });
    logger.error('Sign-in error', { error: e.message });
    next(e);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/refresh
 *
 * Client flow:
 *   1. Access token expires → middleware returns 401 { code: 'TOKEN_EXPIRED' }
 *   2. Client calls this endpoint (refresh_token cookie is sent automatically
 *      because path = /api/auth)
 *   3. Server rotates the refresh token and issues a fresh access token
 *   4. Client retries the original request with the new access token
 *
 * The client does NOT need to send any body — both tokens are in cookies.
 */
export const refresh = async (req, res, next) => {
  try {
    const rawRefreshToken = req.cookies?.refresh_token;

    if (!rawRefreshToken) {
      return res.status(401).json({
        error:   'Refresh token missing',
        code:    'NO_REFRESH_TOKEN',
        message: 'Please sign in again.',
      });
    }

    // rotateRefreshToken handles all validation and reuse detection internally
    const { userId, rawToken: newRawToken } = await rotateRefreshToken(
      rawRefreshToken,
      extractDeviceHint(req.get('User-Agent'))
    );

    // Fetch user data to sign a fresh access token
    // (we only stored id in the refresh token — fetch name/role from DB)
    const { db } = await import('#config/database.js');
    const { users } = await import('#models/user.model.js');
    const { eq } = await import('drizzle-orm');

    const [user] = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      // User was deleted after the refresh token was issued
      cookies.clearAccessToken(res);
      cookies.clearRefreshToken(res);
      return res.status(401).json({
        error:   'User not found',
        code:    'USER_NOT_FOUND',
        message: 'Please sign in again.',
      });
    }

    // Issue new access token
    const newAccessToken = jwttoken.sign({
      id:   user.id,
      name: user.name,
      role: user.role,
    });

    // Set both cookies — new access token + new (rotated) refresh token
    cookies.setAccessToken(res, newAccessToken);
    cookies.setRefreshToken(res, newRawToken);

    logger.info('Token pair refreshed', { userId });

    return res.status(200).json({
      message: 'Token refreshed successfully',
    });
  } catch (e) {
    // rotateRefreshToken throws with descriptive messages for every failure case
    if (
      e.message === 'Invalid refresh token'            ||
      e.message === 'Refresh token has been revoked — please sign in again' ||
      e.message === 'Refresh token has expired — please sign in again'      ||
      e.message === 'Refresh token reuse detected — please sign in again'
    ) {
      // Clear both cookies — client must sign in again
      cookies.clearAccessToken(res);
      cookies.clearRefreshToken(res);

      return res.status(401).json({
        error:   e.message,
        code:    'REFRESH_FAILED',
        message: 'Please sign in again.',
      });
    }

    logger.error('Token refresh error', { error: e.message });
    next(e);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGN OUT  (current device)
// ─────────────────────────────────────────────────────────────────────────────

export const signOut = async (req, res, next) => {
  try {
    const rawRefreshToken = req.cookies?.refresh_token;

    if (rawRefreshToken) {
      // Best-effort revocation — don't fail sign-out if DB call errors
      await revokeRefreshToken(rawRefreshToken).catch(err => {
        logger.warn('Could not revoke refresh token during sign-out', {
          error: err.message,
        });
      });
    }

    cookies.clearAccessToken(res);
    cookies.clearRefreshToken(res);

    logger.info('User signed out', { userId: req.user?.id });

    return res.status(200).json({ message: 'Signed out successfully' });
  } catch (e) {
    logger.error('Sign-out error', { error: e.message });
    next(e);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGN OUT ALL  (all devices)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/sign-out-all
 *
 * Revokes every active refresh token for the user — signs them out of all
 * devices simultaneously.  Useful after a password change or suspected
 * account compromise.
 *
 * Requires a valid access token (authenticateToken middleware).
 */
export const signOutAll = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const deletedCount = await revokeAllUserTokens(userId);

    cookies.clearAccessToken(res);
    cookies.clearRefreshToken(res);

    logger.info('User signed out from all devices', { userId, deletedCount });

    return res.status(200).json({
      message: `Signed out from all devices (${deletedCount} session(s) revoked)`,
    });
  } catch (e) {
    logger.error('Sign-out-all error', { error: e.message });
    next(e);
  }
};