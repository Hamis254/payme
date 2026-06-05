/**
 * =============================================================================
 * UTIL: COOKIES
 * =============================================================================
 *
 * Centralises all cookie options so access token and refresh token cookies
 * are set / cleared consistently everywhere.
 *
 * ACCESS TOKEN COOKIE  ('token')
 *   maxAge: 15 minutes — matches the JWT expiry exactly.
 *   After 15 minutes the browser stops sending it, forcing the client to call
 *   POST /api/auth/refresh with the refresh token cookie.
 *
 * REFRESH TOKEN COOKIE  ('refresh_token')
 *   maxAge: 7 days — matches the DB row's expires_at.
 *   path: /api/auth — the browser ONLY sends this cookie to the refresh and
 *   sign-out endpoints.  It never leaks to /api/payme/, /api/sales/, etc.
 *   This is the most important security property of the cookie design: even
 *   if XSS reads document.cookie (impossible with httpOnly, but defence in
 *   depth), the refresh token is scoped to two endpoints only.
 *
 * @module utils/cookies
 * =============================================================================
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** 15 minutes in ms — must match ACCESS_TOKEN_TTL in jwt.js */
const ACCESS_TOKEN_MAX_AGE_MS  = 15 * 60 * 1000;

/** 7 days in ms — must match REFRESH_TOKEN_TTL_MS in jwt.js */
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const cookies = {
  // ── Access token cookie ──────────────────────────────────────────────────

  setAccessToken: (res, token) => {
    res.cookie('token', token, {
      httpOnly:  true,
      secure:    IS_PRODUCTION,
      sameSite:  'strict',
      maxAge:    ACCESS_TOKEN_MAX_AGE_MS,
      // No `path` restriction — the access token is sent to all API routes.
    });
  },

  clearAccessToken: res => {
    res.clearCookie('token', {
      httpOnly:  true,
      secure:    IS_PRODUCTION,
      sameSite:  'strict',
    });
  },

  // ── Refresh token cookie ──────────────────────────────────────────────────

  setRefreshToken: (res, token) => {
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure:   IS_PRODUCTION,
      sameSite: 'strict',
      maxAge:   REFRESH_TOKEN_MAX_AGE_MS,
      // KEY SECURITY PROPERTY: browser only sends this cookie to /api/auth/*
      // It never appears in requests to /api/payme/, /api/sales/, etc.
      path:     '/api/auth',
    });
  },

  clearRefreshToken: res => {
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure:   IS_PRODUCTION,
      sameSite: 'strict',
      path:     '/api/auth', // must match the path used in setRefreshToken
    });
  },

  // ── Legacy helpers (kept so any code still calling cookies.set/clear works) ─

  /**
   * @deprecated Use setAccessToken / setRefreshToken directly.
   */
  set: (res, name, value, options = {}) => {
    res.cookie(name, value, {
      httpOnly: true,
      secure:   IS_PRODUCTION,
      sameSite: 'strict',
      maxAge:   ACCESS_TOKEN_MAX_AGE_MS,
      ...options,
    });
  },

  /**
   * @deprecated Use clearAccessToken / clearRefreshToken directly.
   */
  clear: (res, name, options = {}) => {
    res.clearCookie(name, {
      httpOnly: true,
      secure:   IS_PRODUCTION,
      sameSite: 'strict',
      ...options,
    });
  },

  get: (req, name) => req.cookies?.[name] ?? null,
};

export default cookies;