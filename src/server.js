/**
 * =============================================================================
 * SERVICE: AUTH
 * =============================================================================
 *
 * Owns all DB operations for authentication:
 *
 *   EXISTING (unchanged):
 *     hashPassword        — bcrypt hash
 *     comparePassword     — bcrypt compare
 *     createUser          — register new user with duplicate checks
 *     authenticateUser    — verify name + password
 *
 *   ADDED (required by auth.controller.js):
 *     issueRefreshToken   — insert a new refresh token row
 *     rotateRefreshToken  — atomic single-use rotation with reuse detection
 *     revokeRefreshToken  — sign-out one device (deletes the row)
 *     revokeAllUserTokens — sign-out all devices (deletes all rows for user)
 *     cleanupExpiredTokens — maintenance, call from a daily cron
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
// PASSWORD HELPERS  (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

export const hashPassword = async password => {
  try {
    return await bcrypt.hash(password, 10);
  } catch (e) {
    logger.error(`Error hashing the password: ${e}`);
    throw new Error('Error hashing');
  }
};

export const comparePassword = async (password, hashedPassword) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (e) {
    logger.error(`Error comparing password: ${e}`);
    throw new Error('Error comparing password');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT  (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

export const createUser = async ({
  name,
  phone_number,
  password,
  role = 'user',
}) => {
  try {
    // Check if user with this name already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.name, name))
      .limit(1);

    if (existingUser.length > 0) {
      throw new Error('User with this name already exists');
    }

    // Check if phone number already exists
    const existingPhone = await db
      .select()
      .from(users)
      .where(eq(users.phone_number, phone_number))
      .limit(1);

    if (existingPhone.length > 0) {
      throw new Error('User with this phone number already exists');
    }

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

    logger.info(`User ${newUser.name} created successfully`);
    return newUser;
  } catch (e) {
    logger.error(`Error creating the user: ${e}`);
    throw e;
  }
};

export const authenticateUser = async ({ name, password }) => {
  try {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.name, name))
      .limit(1);

    if (!existingUser) {
      throw new Error('User not found');
    }

    const isPasswordValid = await comparePassword(
      password,
      existingUser.password
    );

    if (!isPasswordValid) {
      throw new Error('Invalid password');
    }

    logger.info(`User ${existingUser.name} authenticated successfully`);
    return {
      id:           existingUser.id,
      name:         existingUser.name,
      phone_number: existingUser.phone_number,
      email:        existingUser.email,
      role:         existingUser.role,
      created_at:   existingUser.created_at,
    };
  } catch (e) {
    logger.error(`Error authenticating user: ${e}`);
    throw e;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH TOKEN MANAGEMENT  (new — required by auth.controller.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a raw refresh token, hash it, and insert a row into refresh_tokens.
 *
 * The raw token is returned to the controller which puts it in the cookie.
 * Only the SHA-256 hash ever touches the database — if the DB leaks the hashes
 * are useless without the originals (512 bits of entropy, pre-image infeasible).
 *
 * familyId is set to the hash of the very first token in the session on first
 * login (when no familyId is passed in).  Every rotation preserves it so the
 * whole chain can be revoked in one query if reuse is detected.
 *
 * @param {number}      userId
 * @param {string|null} [deviceHint]  - coarse UA string e.g. 'Android'
 * @param {string|null} [familyId]    - omit on first login; provide on rotation
 * @returns {Promise<{ rawToken: string, expiresAt: Date }>}
 */
export const issueRefreshToken = async (
  userId,
  deviceHint = null,
  familyId = null
) => {
  const rawToken  = jwttoken.generateRefreshToken();
  const tokenHash = jwttoken.hashRefreshToken(rawToken);
  const expiresAt = jwttoken.refreshTokenExpiresAt();

  // On first login seed the family with the hash of the first token
  const resolvedFamilyId = familyId ?? tokenHash;

  await db.insert(refreshTokens).values({
    user_id:     userId,
    token_hash:  tokenHash,
    family_id:   resolvedFamilyId,
    status:      'active',
    device_hint: deviceHint,
    expires_at:  expiresAt,
  });

  logger.info('Refresh token issued', { userId, deviceHint });
  return { rawToken, expiresAt };
};

/**
 * Validate a presented refresh token and atomically issue a replacement.
 *
 * Five outcomes, each with a distinct log entry and thrown message:
 *
 *   ✓ active + not expired  → mark old row 'rotated', insert new row, return new token
 *   ✗ status = 'rotated'    → REUSE: revoke entire family, throw
 *   ✗ status = 'revoked'    → explicitly invalidated, throw
 *   ✗ expired               → treat same as not found, throw
 *   ✗ not found             → invalid token, throw
 *
 * @param {string}      rawToken    - the raw hex string from the client cookie
 * @param {string|null} [deviceHint]
 * @returns {Promise<{ userId: number, rawToken: string, expiresAt: Date }>}
 * @throws {Error}
 */
export const rotateRefreshToken = async (rawToken, deviceHint = null) => {
  const tokenHash = jwttoken.hashRefreshToken(rawToken);

  const [existing] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.token_hash, tokenHash))
    .limit(1);

  // ── Not in DB ────────────────────────────────────────────────────────────
  if (!existing) {
    logger.warn('Refresh token not found', {
      tokenHashPrefix: tokenHash.slice(0, 8),
    });
    throw new Error('Invalid refresh token');
  }

  // ── Reuse detected: token was already rotated ─────────────────────────────
  // Replaying an old rotated token = strong signal of theft.
  // Revoke the ENTIRE family — forces the real user to re-authenticate.
  if (existing.status === 'rotated') {
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

  // ── Explicitly revoked ────────────────────────────────────────────────────
  if (existing.status === 'revoked') {
    logger.warn('Revoked refresh token presented', { userId: existing.user_id });
    throw new Error('Refresh token has been revoked — please sign in again');
  }

  // ── Expired ───────────────────────────────────────────────────────────────
  if (existing.expires_at < new Date()) {
    logger.info('Expired refresh token presented', { userId: existing.user_id });
    throw new Error('Refresh token has expired — please sign in again');
  }

  // ── Valid — rotate ────────────────────────────────────────────────────────
  // Mark this token 'rotated' (keeps the audit trail intact for reuse detection)
  await db
    .update(refreshTokens)
    .set({ status: 'rotated' })
    .where(eq(refreshTokens.token_hash, tokenHash));

  // Issue a new token in the same family
  const { rawToken: newRawToken, expiresAt } = await issueRefreshToken(
    existing.user_id,
    deviceHint,
    existing.family_id // preserve family across every rotation
  );

  logger.info('Refresh token rotated', { userId: existing.user_id });
  return { userId: existing.user_id, rawToken: newRawToken, expiresAt };
};

/**
 * Revoke a specific refresh token (sign-out one device).
 * Deletes the row — no need to keep a tombstone for a deliberate sign-out.
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
 * Called by POST /api/auth/sign-out-all.
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
 * 'rotated' rows are intentionally kept until their expires_at passes —
 * they are the evidence that makes reuse detection work.  Deleting them
 * immediately would turn a replayed rotated token into "not found" instead
 * of triggering the family revocation.
 *
 * @returns {Promise<number>} rows deleted
 */
export const cleanupExpiredTokens = async () => {
  const deleted = await db
    .delete(refreshTokens)
    .where(lt(refreshTokens.expires_at, new Date()))
    .returning({ id: refreshTokens.id });

  logger.info('Refresh token cleanup complete', { deletedCount: deleted.length });
  return deleted.length;
};