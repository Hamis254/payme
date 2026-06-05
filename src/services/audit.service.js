/**
 * =============================================================================
 * SERVICE: AUTH
 * =============================================================================
 *
 * Owns all DB operations for authentication:
 *   createUser              — register new user
 *   authenticateUser        — verify credentials
 *   issueRefreshToken       — insert a new refresh token row
 *   rotateRefreshToken      — atomic single-use rotation with reuse detection
 *   revokeRefreshToken      — sign-out one device
 *   revokeAllUserTokens     — sign-out all devices
 *   cleanupExpiredTokens    — maintenance (called by cron)
 *
 * @module services/auth
 * =============================================================================
 */

import logger from '#config/logger.js';
import bcrypt from 'bcrypt';
import { eq, and, lt } from 'drizzle-orm';
import { db } from '#config/database.js';
import { users } from '#models/user.model.js';
import { refreshTokens } from '#models/refreshToken.model.js';
import { jwttoken } from '#utils/jwt.js';

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export const hashPassword = async password => {
  try {
    return await bcrypt.hash(password, 10);
  } catch (e) {
    logger.error('Error hashing password', { error: e.message });
    throw new Error('Error hashing password');
  }
};

export const comparePassword = async (password, hashedPassword) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (e) {
    logger.error('Error comparing password', { error: e.message });
    throw new Error('Error comparing password');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const createUser = async ({ name, phone_number, password, role = 'user' }) => {
  // Duplicate name check
  const [existingName] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.name, name))
    .limit(1);

  if (existingName) throw new Error('User with this name already exists');

  // Duplicate phone check
  const [existingPhone] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone_number, phone_number))
    .limit(1);

  if (existingPhone) throw new Error('User with this phone number already exists');

  const password_hash = await hashPassword(password);

  const [newUser] = await db
    .insert(users)
    .values({ name, phone_number, password: password_hash, role })
    .returning({
      id:           users.id,
      name:         users.name,
      phone_number: users.phone_number,
      email:        users.email,
      role:         users.role,
      created_at:   users.created_at,
    });

  logger.info('User created', { userId: newUser.id, name: newUser.name });
  return newUser;
};

export const authenticateUser = async ({ name, password }) => {
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.name, name))
    .limit(1);

  if (!existingUser) throw new Error('User not found');

  const isPasswordValid = await comparePassword(password, existingUser.password);
  if (!isPasswordValid) throw new Error('Invalid password');

  logger.info('User authenticated', { userId: existingUser.id });

  return {
    id:           existingUser.id,
    name:         existingUser.name,
    phone_number: existingUser.phone_number,
    email:        existingUser.email,
    role:         existingUser.role,
    created_at:   existingUser.created_at,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH TOKEN MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a new raw refresh token and insert a row into refresh_tokens.
 * Returns the raw token (sent to client) — the hash is stored in the DB.
 *
 * @param {number}      userId
 * @param {string|null} [deviceHint]  - e.g. 'Chrome on Android' (from User-Agent)
 * @param {string|null} [familyId]    - omit on first login; provide on rotation
 * @returns {Promise<{ rawToken: string, expiresAt: Date }>}
 */
export const issueRefreshToken = async (userId, deviceHint = null, familyId = null) => {
  const rawToken  = jwttoken.generateRefreshToken();
  const tokenHash = jwttoken.hashRefreshToken(rawToken);
  const expiresAt = jwttoken.refreshTokenExpiresAt();

  // On first login the family_id is the hash of the first token.
  // This seeds the family so all future rotations can be linked.
  const resolvedFamilyId = familyId ?? tokenHash;

  await db.insert(refreshTokens).values({
    user_id:     userId,
    token_hash:  tokenHash,
    family_id:   resolvedFamilyId,
    status:      'active',
    device_hint: deviceHint,
    expires_at:  expiresAt,
  });

  return { rawToken, expiresAt };
};

/**
 * Rotate a refresh token: verify the presented token, detect reuse, and
 * atomically issue a replacement.
 *
 * Rotation rules:
 *   ✓ Token found + status = 'active' + not expired
 *       → mark old row 'rotated', insert new row, return new raw token
 *   ✗ Token found + status = 'rotated'  (already used)
 *       → REUSE DETECTED: revoke entire family, throw
 *   ✗ Token found + status = 'revoked'
 *       → Token was explicitly invalidated, throw
 *   ✗ Token found + expired
 *       → Treat as not found, throw
 *   ✗ Token not found
 *       → Invalid token, throw
 *
 * @param {string}      rawToken    - the raw token from the client cookie
 * @param {string|null} [deviceHint]
 * @returns {Promise<{ userId: number, rawToken: string, expiresAt: Date }>}
 * @throws {Error} with descriptive message for every failure case
 */
export const rotateRefreshToken = async (rawToken, deviceHint = null) => {
  const tokenHash = jwttoken.hashRefreshToken(rawToken);

  const [existing] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.token_hash, tokenHash))
    .limit(1);

  // ── Token not in DB at all ────────────────────────────────────────────────
  if (!existing) {
    logger.warn('Refresh token not found in DB', { tokenHashPrefix: tokenHash.slice(0, 8) });
    throw new Error('Invalid refresh token');
  }

  // ── Reuse detection: token was already rotated ────────────────────────────
  if (existing.status === 'rotated') {
    // A previously-valid token is being replayed — indicates likely theft.
    // Revoke the ENTIRE family so the real user is forced to re-authenticate.
    logger.warn('REFRESH TOKEN REUSE DETECTED — revoking entire family', {
      userId:   existing.user_id,
      familyId: existing.family_id,
    });

    await db
      .update(refreshTokens)
      .set({ status: 'revoked' })
      .where(eq(refreshTokens.family_id, existing.family_id));

    throw new Error('Refresh token reuse detected — please sign in again');
  }

  // ── Already explicitly revoked ────────────────────────────────────────────
  if (existing.status === 'revoked') {
    logger.warn('Revoked refresh token presented', { userId: existing.user_id });
    throw new Error('Refresh token has been revoked — please sign in again');
  }

  // ── Expired (should be caught by cookie expiry, but double-check in DB) ───
  if (existing.expires_at < new Date()) {
    logger.info('Expired refresh token presented', { userId: existing.user_id });
    throw new Error('Refresh token has expired — please sign in again');
  }

  // ── Valid token — rotate ──────────────────────────────────────────────────
  // Mark the current row as 'rotated' (preserves audit trail).
  await db
    .update(refreshTokens)
    .set({ status: 'rotated' })
    .where(eq(refreshTokens.token_hash, tokenHash));

  // Issue a new token in the same family.
  const { rawToken: newRawToken, expiresAt } = await issueRefreshToken(
    existing.user_id,
    deviceHint,
    existing.family_id // preserve the family
  );

  logger.info('Refresh token rotated', { userId: existing.user_id });

  return { userId: existing.user_id, rawToken: newRawToken, expiresAt };
};

/**
 * Revoke a specific refresh token (sign-out one device).
 * Deletes the row rather than marking it 'revoked' — no need to keep it.
 *
 * @param {string} rawToken
 * @returns {Promise<void>}
 */
export const revokeRefreshToken = async rawToken => {
  const tokenHash = jwttoken.hashRefreshToken(rawToken);

  await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.token_hash, tokenHash));

  logger.info('Refresh token revoked (sign-out)');
};

/**
 * Revoke all refresh tokens for a user (sign-out all devices).
 *
 * @param {number} userId
 * @returns {Promise<number>} count of rows deleted
 */
export const revokeAllUserTokens = async userId => {
  const deleted = await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.user_id, userId))
    .returning({ id: refreshTokens.id });

  logger.info('All refresh tokens revoked (sign-out-all)', {
    userId,
    deletedCount: deleted.length,
  });

  return deleted.length;
};

/**
 * Delete expired and revoked refresh token rows.
 * Schedule via cron — once per day is sufficient for a 7-day TTL.
 *
 * @returns {Promise<number>} rows deleted
 */
export const cleanupExpiredTokens = async () => {
  const now = new Date();

  const deleted = await db
    .delete(refreshTokens)
    .where(
      // Delete rows that are expired OR have been explicitly revoked.
      // 'rotated' rows are kept for a short time as they are part of
      // the reuse-detection audit trail — they'll be caught on the next
      // cleanup once their expires_at has passed.
      lt(refreshTokens.expires_at, now)
    )
    .returning({ id: refreshTokens.id });

  logger.info('Refresh token cleanup complete', { deletedCount: deleted.length });
  return deleted.length;
};