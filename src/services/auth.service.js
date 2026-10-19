import logger from '#config/logger.js';
import bcrypt from 'bcrypt';
import { eq, and } from 'drizzle-orm';
import { db } from '#config/database.js';
import { users } from '#models/user.model.js';
import { refreshTokens } from '#models/refreshToken.model.js';
import { jwttoken } from '#utils/jwt.js';
import { encrypt, hashForLookup } from '#utils/encryption.js';

// Lockout policy for the 4-digit PIN. A 4-digit PIN only has 10,000
// possible values, so unlimited guessing would be trivial — this is the
// mitigation that makes a short PIN acceptable, the same way ATM cards
// lock after a few wrong PIN entries.
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD HELPERS
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
// USER CREATE / AUTHENTICATE
// ─────────────────────────────────────────────────────────────────────────────

export const createUser = async ({
  name,
  id_number,
  phone_number,
  email,
  password,
  role = 'user',
}) => {
  try {
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.name, name))
      .limit(1);

    if (existingUser.length > 0) {
      throw new Error('User with this name already exists');
    }

    const existingPhone = await db
      .select()
      .from(users)
      .where(eq(users.phone_number, phone_number))
      .limit(1);

    if (existingPhone.length > 0) {
      throw new Error('User with this phone number already exists');
    }

    // Check if ID number already exists — via the deterministic lookup hash,
    // since the encrypted column itself can't be searched with `=`.
    const idNumberHash = hashForLookup(id_number);
    const existingIdNumber = await db
      .select()
      .from(users)
      .where(eq(users.id_number_hash, idNumberHash))
      .limit(1);

    if (existingIdNumber.length > 0) {
      throw new Error('User with this ID number already exists');
    }

    const password_hash = await hashPassword(password);
    const encryptedIdNumber = encrypt(id_number, `user.${name}.id_number`);

    const [newUser] = await db
      .insert(users)
      .values({
        name,
        id_number: encryptedIdNumber,
        id_number_hash: idNumberHash,
        phone_number,
        email,
        password: password_hash,
        role,
      })
      .returning({
        id: users.id,
        name: users.name,
        phone_number: users.phone_number,
        email: users.email,
        role: users.role,
        created_at: users.created_at,
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

    // Locked out — refuse even if the PIN is correct, until the lock expires.
    if (
      existingUser.locked_until &&
      new Date(existingUser.locked_until) > new Date()
    ) {
      const minutesLeft = Math.ceil(
        (new Date(existingUser.locked_until) - new Date()) / 60000
      );
      logger.warn('Sign-in blocked — account temporarily locked', {
        userId: existingUser.id,
        minutesLeft,
      });
      throw new Error(
        `Account temporarily locked due to repeated failed attempts. Try again in ${minutesLeft} minute(s).`
      );
    }

    const isPasswordValid = await comparePassword(
      password,
      existingUser.password
    );

    if (!isPasswordValid) {
      const newFailedAttempts = (existingUser.failed_login_attempts || 0) + 1;
      const shouldLock = newFailedAttempts >= MAX_FAILED_ATTEMPTS;

      await db
        .update(users)
        .set({
          failed_login_attempts: shouldLock ? 0 : newFailedAttempts,
          locked_until: shouldLock
            ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60000)
            : existingUser.locked_until,
          updated_at: new Date(),
        })
        .where(eq(users.id, existingUser.id));

      if (shouldLock) {
        logger.warn('Account locked after repeated failed sign-in attempts', {
          userId: existingUser.id,
        });
        throw new Error(
          `Too many failed attempts. Account locked for ${LOCK_DURATION_MINUTES} minutes.`
        );
      }

      throw new Error('Invalid password');
    }

    // Successful login — reset the failed-attempt counter.
    if (existingUser.failed_login_attempts > 0 || existingUser.locked_until) {
      await db
        .update(users)
        .set({
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: new Date(),
        })
        .where(eq(users.id, existingUser.id));
    }

    logger.info(`User ${existingUser.name} authenticated successfully`);
    return {
      id: existingUser.id,
      name: existingUser.name,
      phone_number: existingUser.phone_number,
      email: existingUser.email,
      role: existingUser.role,
      created_at: existingUser.created_at,
    };
  } catch (e) {
    logger.error(`Error authenticating user: ${e}`);
    throw e;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH TOKEN LIFECYCLE
// Backed by the refresh_tokens table (#models/refreshToken.model.js) and the
// generateRefreshToken / hashRefreshToken / refreshTokenExpiresAt helpers
// already defined on jwttoken (#utils/jwt.js). See that model's docblock for
// the full lifecycle diagram — summarized inline at each function below.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue a brand new refresh token row (sign-in / sign-up).
 *
 * @param {number} userId
 * @param {string|null} [deviceHint] - e.g. "Android", "Chrome on Windows"
 * @param {string|null} [familyId] - only passed internally by rotateRefreshToken;
 *   omit this when calling from a controller (sign-in/sign-up always start
 *   a brand new family).
 * @returns {Promise<{ rawToken: string, tokenHash: string, familyId: string }>}
 */
export const issueRefreshToken = async (
  userId,
  deviceHint = null,
  familyId = null
) => {
  try {
    const rawToken = jwttoken.generateRefreshToken();
    const tokenHash = jwttoken.hashRefreshToken(rawToken);
    // First issuance: the family is identified by its own token hash.
    const resolvedFamilyId = familyId || tokenHash;

    await db.insert(refreshTokens).values({
      user_id: userId,
      token_hash: tokenHash,
      family_id: resolvedFamilyId,
      status: 'active',
      device_hint: deviceHint,
      expires_at: jwttoken.refreshTokenExpiresAt(),
    });

    return { rawToken, tokenHash, familyId: resolvedFamilyId };
  } catch (e) {
    logger.error('Error issuing refresh token', { error: e.message, userId });
    throw e;
  }
};

/**
 * Rotate a refresh token: validates the presented token, marks it 'rotated',
 * and issues a fresh one in the same family.
 *
 * Reuse detection: if a token that was already rotated is presented again,
 * that's a signal of theft (someone replayed an old token) — every token in
 * that family gets revoked, forcing a full re-login on every device sharing
 * that session chain.
 *
 * @param {string} rawToken - the refresh token presented by the client
 * @param {string|null} [deviceHint]
 * @returns {Promise<{ userId: number, rawToken: string }>}
 * @throws {Error} with one of the descriptive messages the controller matches on
 */
export const rotateRefreshToken = async (rawToken, deviceHint = null) => {
  try {
    const tokenHash = jwttoken.hashRefreshToken(rawToken);

    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token_hash, tokenHash))
      .limit(1);

    if (!row) {
      throw new Error('Invalid refresh token');
    }

    if (row.status === 'revoked') {
      throw new Error('Refresh token has been revoked — please sign in again');
    }

    if (new Date(row.expires_at) < new Date()) {
      throw new Error('Refresh token has expired — please sign in again');
    }

    if (row.status === 'rotated') {
      // Reuse of an already-exchanged token — treat as theft, kill the family.
      await db
        .update(refreshTokens)
        .set({ status: 'revoked' })
        .where(eq(refreshTokens.family_id, row.family_id));

      logger.warn('Refresh token reuse detected — family revoked', {
        userId: row.user_id,
        familyId: row.family_id,
      });
      throw new Error('Refresh token reuse detected — please sign in again');
    }

    // status === 'active' — valid single use. Mark this row rotated, then
    // issue the next token in the same family.
    await db
      .update(refreshTokens)
      .set({ status: 'rotated' })
      .where(eq(refreshTokens.id, row.id));

    const { rawToken: newRawToken } = await issueRefreshToken(
      row.user_id,
      deviceHint || row.device_hint,
      row.family_id
    );

    return { userId: row.user_id, rawToken: newRawToken };
  } catch (e) {
    logger.error('Error rotating refresh token', { error: e.message });
    throw e;
  }
};

/**
 * Revoke a single refresh token (sign-out on the current device only).
 * Best-effort — if the token isn't found, treat it as already signed out.
 *
 * @param {string} rawToken
 * @returns {Promise<void>}
 */
export const revokeRefreshToken = async rawToken => {
  try {
    const tokenHash = jwttoken.hashRefreshToken(rawToken);
    await db
      .update(refreshTokens)
      .set({ status: 'revoked' })
      .where(eq(refreshTokens.token_hash, tokenHash));
  } catch (e) {
    logger.error('Error revoking refresh token', { error: e.message });
    throw e;
  }
};

/**
 * Revoke every refresh token belonging to a user (sign-out on all devices).
 *
 * @param {number} userId
 * @returns {Promise<number>} number of sessions revoked
 */
export const revokeAllUserTokens = async userId => {
  try {
    const result = await db
      .update(refreshTokens)
      .set({ status: 'revoked' })
      .where(
        and(eq(refreshTokens.user_id, userId), eq(refreshTokens.status, 'active'))
      )
      .returning({ id: refreshTokens.id });

    return result.length;
  } catch (e) {
    logger.error('Error revoking all user tokens', { error: e.message, userId });
    throw e;
  }
};