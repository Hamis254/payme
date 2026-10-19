/**
 * =============================================================================
 * MIDDLEWARE: AUTH
 * =============================================================================
 *
 * authenticateToken — verifies the short-lived access token (JWT).
 *   • Expired token  → 401  { code: 'TOKEN_EXPIRED' }
 *     The client sees this code and immediately calls POST /api/auth/refresh
 *     to get a new access token without asking the user to log in again.
 *   • Invalid token  → 401  { code: 'INVALID_TOKEN' }
 *     The client should redirect to the sign-in screen.
 *   • No token       → 401  { code: 'NO_TOKEN' }
 *
 * requireRole       — RBAC gate, unchanged from original.
 *
 * attachUserIfPresent — soft auth for public-but-context-aware routes,
 *                       unchanged from original.
 *
 * MOBILE / FLUTTERFLOW SUPPORT  (added)
 * ──────────────────────────────────────
 * The original version only ever read the token from req.cookies.token.
 * That works for a browser client, but a native mobile app (FlutterFlow,
 * Flutter, etc.) sends the access token as a normal
 * "Authorization: Bearer <token>" header instead of a cookie.
 *
 * Fix: getAccessTokenFromRequest() now checks the cookie first (so nothing
 * changes for existing web clients), then falls back to the Authorization
 * header if no cookie is present.
 *
 * @module middleware/auth
 * =============================================================================
 */

import logger from '#config/logger.js';
import { jwttoken } from '#utils/jwt.js';

// ─────────────────────────────────────────────────────────────────────────────
// getAccessTokenFromRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the access token from wherever the client sent it.
 * Web clients: httpOnly cookie (sent automatically).
 * Mobile / FlutterFlow clients: `Authorization: Bearer <token>` header.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
const getAccessTokenFromRequest = req => {
  if (req.cookies?.token) return req.cookies.token;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// authenticateToken
// ─────────────────────────────────────────────────────────────────────────────

export const authenticateToken = (req, res, next) => {
  const token = getAccessTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({
      error:   'Authentication required',
      code:    'NO_TOKEN',
      message: 'No access token provided. Sign in to continue.',
    });
  }

  try {
    // jwttoken.verify now lets jwt errors propagate with their original `name`
    // property so we can distinguish TokenExpiredError from JsonWebTokenError.
    const decoded = jwttoken.verify(token);
    req.user = decoded;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      // Access token has expired — client should call POST /api/auth/refresh.
      // Do NOT log as an error — this is the normal refresh flow, not an attack.
      logger.debug('Access token expired — client should refresh', {
        path: req.path,
      });
      return res.status(401).json({
        error:   'Access token expired',
        code:    'TOKEN_EXPIRED',
        message: 'Your session has expired. Call POST /api/auth/refresh to renew.',
      });
    }

    // Malformed, tampered, or wrong secret — this is a real problem.
    logger.warn('Invalid access token presented', {
      error: e.message,
      path:  req.path,
      ip:    req.ip,
    });

    return res.status(401).json({
      error:   'Invalid token',
      code:    'INVALID_TOKEN',
      message: 'Authentication token is invalid. Please sign in again.',
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// requireRole
// ─────────────────────────────────────────────────────────────────────────────

export const requireRole = allowedRoles => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error:   'Authentication required',
        code:    'NO_TOKEN',
        message: 'User not authenticated',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Access denied — insufficient role', {
        userId:        req.user.id,
        userRole:      req.user.role,
        requiredRoles: allowedRoles,
        path:          req.path,
      });
      return res.status(403).json({
        error:   'Access denied',
        message: `This endpoint requires one of the following roles: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// attachUserIfPresent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft auth: attaches req.user if a valid non-expired access token is present.
 * Never blocks the request — used for global context enrichment in app.js.
 */
export const attachUserIfPresent = (req, _res, next) => {
  const token = getAccessTokenFromRequest(req);
  if (!token) return next();

  try {
    req.user = jwttoken.verify(token);
  } catch {
    // Expired or invalid — silently ignored, req.user stays undefined.
  }

  return next();
};