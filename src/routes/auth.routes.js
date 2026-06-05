import express from 'express';
import {
  signup,
  signIn,
  refresh,
  signOut,
  signOutAll,
} from '#controllers/auth.controller.js';
import { authenticateToken } from '#middleware/auth.middleware.js';

const router = express.Router();

/**
 * POST /api/auth/sign-up
 * Register a new user. Returns access token (cookie) + refresh token (cookie).
 */
router.post('/sign-up', signup);

/**
 * POST /api/auth/sign-in
 * Authenticate with name + password. Returns access + refresh token cookies.
 */
router.post('/sign-in', signIn);

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access + refresh token pair.
 * No body needed — refresh_token is read from the httpOnly cookie.
 * The browser sends the refresh_token cookie automatically because
 * its path is /api/auth.
 */
router.post('/refresh', refresh);

/**
 * POST /api/auth/sign-out
 * Revoke the current refresh token and clear both cookies.
 * Works even if the access token has expired (no authenticateToken here —
 * the user should be able to sign out with only a refresh token).
 */
router.post('/sign-out', signOut);

/**
 * POST /api/auth/sign-out-all
 * Revoke ALL refresh tokens for the user (all devices).
 * Requires a valid access token — this is a deliberate security action.
 */
router.post('/sign-out-all', authenticateToken, signOutAll);

export default router;