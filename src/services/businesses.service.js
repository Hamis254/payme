import crypto from 'node:crypto';
import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { businesses, BRANCH_STATUS } from '#models/setting.model.js';
import { branchApprovalOtps } from '#models/branchApproval.model.js';
import { wallets } from '#models/myWallet.model.js';
import { users } from '#models/user.model.js';
import { notificationService } from '#services/notification.service.js';
import {
  grantLot,
  trialExpiryFor,
  TRIAL_DAYS,
  TRIAL_TOKENS,
} from '#services/tokenLots.service.js';
import { TOKEN_SOURCES } from '#models/tokenLot.model.js';
import {
  branchCodeFor,
  BUSINESS_CODE_CONSTRAINT,
  generateMainCode,
  isUniqueViolation,
  normalizeBusinessCode,
} from '#utils/businessCode.js';
import { and, eq } from 'drizzle-orm';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const MAX_CODE_ATTEMPTS = 5;

/**
 * Fields the server assigns. Clients may read them but never write them after
 * creation. The update path strips them, so no route can change a business's
 * code or place in the tree.
 */
export const SERVER_MANAGED_FIELDS = Object.freeze([
  'business_code',
  'is_main',
  'parent_business_id',
  'branch_sequence',
  'branch_status',
]);

/** An error with an HTTP status, for the controller to map directly. */
export class BusinessError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'BusinessError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// One message for a missing code, a wrong code, a branch code, and a main
// whose owner has no phone. A caller can't use this path to learn which codes
// exist.
const invalidMainCode = () =>
  new BusinessError('Main business code is not valid', 400, 'INVALID_MAIN_CODE');

const invalidOtp = () =>
  new BusinessError('Invalid or expired code', 400, 'INVALID_OTP');

// Shape returned in every business response.
const businessFields = {
  id: businesses.id,
  user_id: businesses.user_id,
  name: businesses.name,
  location: businesses.location,
  location_description: businesses.location_description,
  logo_url: businesses.logo_url,
  payment_method: businesses.payment_method,
  payment_identifier: businesses.payment_identifier,
  verified: businesses.verified,
  business_code: businesses.business_code,
  is_main: businesses.is_main,
  parent_business_id: businesses.parent_business_id,
  branch_status: businesses.branch_status,
  created_at: businesses.created_at,
  updated_at: businesses.updated_at,
};

/** Only the client-writable columns, so nothing else can leak into an insert. */
const ownerFields = (userId, data) => ({
  user_id: userId,
  name: data.name,
  location: data.location,
  location_description: data.location_description,
  logo_url: data.logo_url,
  payment_method: data.payment_method,
  payment_identifier: data.payment_identifier,
});

// ── OTP helpers ─────────────────────────────────────────────────────────────

const generateOtp = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// Keyed by the app secret and bound to the branch, so a stored hash is useless
// for a different branch and can't be brute-forced without the secret.
const hashOtp = (branchId, otp) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`${branchId}:${otp}`)
    .digest('hex');

const sameHash = (a, b) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * Creates a main business with its wallet and a server-generated code.
 * The code is unique per the DB, so a collision retries in a fresh
 * transaction. A failed insert aborts its transaction, so the retry can't
 * reuse it.
 */
export const createBusinessForUser = async (userId, data) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        const [business] = await tx
          .insert(businesses)
          .values({
            ...ownerFields(userId, data),
            business_code: generateMainCode(data.name),
            is_main: true,
            branch_status: BRANCH_STATUS.ACTIVE,
          })
          .returning(businessFields);

        await tx.insert(wallets).values({
          business_id: business.id,
          balance_tokens: 0,
        });

        // Trial tokens are for mains only. This runs in the same transaction,
        // so a rollback takes the grant with it. The grant instant comes from
        // JS, not the DB column: the column has no timezone, so reading it back
        // depends on the server's timezone setting.
        const grantedAt = new Date();
        await grantLot(tx, {
          businessId: business.id,
          source: TOKEN_SOURCES.TRIAL,
          tokens: TRIAL_TOKENS,
          expiresAt: trialExpiryFor(grantedAt),
          txType: 'trial_grant',
          note: `Trial: ${TRIAL_TOKENS} tokens, expires end of day ${TRIAL_DAYS} (EAT)`,
          createdBy: userId,
          now: grantedAt,
        });

        logger.info(
          `Business "${business.name}" (${business.business_code}) and wallet created for user ${userId}`
        );

        return business;
      });
    } catch (e) {
      if (
        isUniqueViolation(e, BUSINESS_CODE_CONSTRAINT) &&
        attempt < MAX_CODE_ATTEMPTS
      ) {
        logger.warn(`Business code collision, retrying (attempt ${attempt})`);
        continue;
      }
      logger.error('Error creating business and wallet', e);
      throw e;
    }
  }
};

/**
 * Creates a branch of a main identified by its business code.
 *
 * Everything runs in one transaction under FOR UPDATE on the main row. The
 * lookup, the next branch_sequence and the insert are serialized per main, so
 * two simultaneous branches get -1 and -2, never the same number.
 *
 * - Same owner as the main: created 'active'.
 * - Different owner: created 'pending_approval', and a one-time code is texted
 *   to the main owner after commit.
 */
export const createBranchForUser = async (userId, data) => {
  const mainCode = normalizeBusinessCode(data.main_business_code);

  const result = await db.transaction(async tx => {
    // Only a main can parent a branch. A branch code, a malformed code and an
    // unknown code all miss this query and get the same error.
    const [main] = await tx
      .select({
        id: businesses.id,
        user_id: businesses.user_id,
        business_code: businesses.business_code,
      })
      .from(businesses)
      .where(
        and(
          eq(businesses.business_code, mainCode),
          eq(businesses.is_main, true)
        )
      )
      .for('update')
      .limit(1);

    if (!main) throw invalidMainCode();

    const siblings = await tx
      .select({ branch_sequence: businesses.branch_sequence })
      .from(businesses)
      .where(eq(businesses.parent_business_id, main.id));

    const sequence =
      siblings.reduce((max, row) => Math.max(max, row.branch_sequence ?? 0), 0) +
      1;

    const sameOwner = main.user_id === userId;

    const [branch] = await tx
      .insert(businesses)
      .values({
        ...ownerFields(userId, data),
        business_code: branchCodeFor(main.business_code, sequence),
        is_main: false,
        parent_business_id: main.id,
        branch_sequence: sequence,
        branch_status: sameOwner
          ? BRANCH_STATUS.ACTIVE
          : BRANCH_STATUS.PENDING_APPROVAL,
      })
      .returning(businessFields);

    await tx.insert(wallets).values({
      business_id: branch.id,
      balance_tokens: 0,
    });

    if (sameOwner) {
      return { branch, approval: null };
    }

    const [owner] = await tx
      .select({ phone_number: users.phone_number })
      .from(users)
      .where(eq(users.id, main.user_id))
      .limit(1);

    // Without a phone the OTP can't reach the owner, so refuse the request.
    // The error is the generic one, so the owner's phone state isn't exposed.
    if (!owner?.phone_number) {
      logger.warn(`Main ${main.business_code} owner has no phone; branch refused`);
      throw invalidMainCode();
    }

    const otp = await issueApprovalOtp(tx, branch.id, main.id);

    return {
      branch,
      approval: {
        phone: owner.phone_number,
        otp,
        mainCode: main.business_code,
      },
    };
  });

  if (!result.approval) {
    return { business: result.branch, otp_sent: false };
  }

  // The SMS goes out only after commit, so a rolled-back transaction never
  // texts a code that isn't stored.
  const sent = await sendApprovalOtpSms({
    ...result.approval,
    branch: result.branch,
  });

  return { business: result.branch, otp_sent: sent };
};

// ── Approval codes ──────────────────────────────────────────────────────────

// Codes per branch, the first one included. Caps SMS spend, and stops resend
// from being used to keep guessing indefinitely.
export const MAX_OTP_ISSUES = 5;

/**
 * Inserts a new code and returns the plaintext. Only the hash is stored. Runs
 * inside the caller's transaction, so a rollback drops the code too.
 *
 * Older codes stay in the table, but approve checks only the newest unconsumed
 * one. Issuing a new code therefore supersedes the old one.
 */
async function issueApprovalOtp(tx, branchId, mainId) {
  const otp = generateOtp();
  await tx.insert(branchApprovalOtps).values({
    branch_business_id: branchId,
    main_business_id: mainId,
    otp_hash: hashOtp(branchId, otp),
    expires_at: new Date(Date.now() + OTP_TTL_MS),
  });
  return otp;
}

/** Texts the code to the main owner. Resolves to false if the gateway rejects it. */
async function sendApprovalOtpSms({ phone, otp, mainCode, branch }) {
  const sent = await notificationService.sendDirectSMS(
    phone,
    `PayMe: "${branch.name}" (${branch.business_code}) asks to join ${mainCode} as a branch. ` +
      `Code: ${otp}. Share it only if you approve. Valid for 10 minutes.`
  );

  if (!sent) {
    logger.error(
      `Branch ${branch.business_code} OTP SMS was not delivered to the main owner`
    );
  }
  return sent;
}

/**
 * Issues a fresh code for a branch that is still pending. This recovers a
 * branch whose SMS failed, whose code expired, or that was locked out after
 * too many wrong guesses.
 *
 * The branch row is locked, so two concurrent resends can't both get under
 * the MAX_OTP_ISSUES cap. Only the branch's requester can call it.
 */
export const resendBranchApprovalForUser = async (userId, branchId) => {
  const issued = await db.transaction(async tx => {
    const [branch] = await tx
      .select(businessFields)
      .from(businesses)
      .where(eq(businesses.id, branchId))
      .for('update')
      .limit(1);

    if (!branch || branch.user_id !== userId) {
      throw new BusinessError('Business not found', 404, 'NOT_FOUND');
    }
    if (branch.is_main) {
      throw new BusinessError('Only a branch needs approval', 409, 'NOT_A_BRANCH');
    }
    if (branch.branch_status === BRANCH_STATUS.ACTIVE) {
      throw new BusinessError('Branch is already active', 409, 'ALREADY_ACTIVE');
    }

    const issuedSoFar = await tx
      .select({ id: branchApprovalOtps.id })
      .from(branchApprovalOtps)
      .where(eq(branchApprovalOtps.branch_business_id, branchId));

    if (issuedSoFar.length >= MAX_OTP_ISSUES) {
      throw new BusinessError(
        'Too many codes have been requested for this branch',
        429,
        'OTP_LIMIT'
      );
    }

    const [main] = await tx
      .select({
        id: businesses.id,
        user_id: businesses.user_id,
        business_code: businesses.business_code,
      })
      .from(businesses)
      .where(eq(businesses.id, branch.parent_business_id))
      .limit(1);

    const [owner] = await tx
      .select({ phone_number: users.phone_number })
      .from(users)
      .where(eq(users.id, main.user_id))
      .limit(1);

    if (!owner?.phone_number) {
      throw new BusinessError(
        'The main business owner has no phone number on file',
        409,
        'NO_OWNER_PHONE'
      );
    }

    const otp = await issueApprovalOtp(tx, branch.id, main.id);
    return {
      branch,
      phone: owner.phone_number,
      otp,
      mainCode: main.business_code,
    };
  });

  const sent = await sendApprovalOtpSms(issued);
  return { business: issued.branch, otp_sent: sent };
};

// ── Branch approval ─────────────────────────────────────────────────────────

/**
 * Activates a pending branch once the requester enters the OTP texted to the
 * main owner. Only the user who requested the branch may submit a code.
 *
 * A wrong code is recorded as a committed write, not a throw, because a throw
 * would roll back the attempt count and allow unlimited guessing.
 */
export const approveBranchForUser = async (userId, branchId, otp) => {
  const outcome = await db.transaction(async tx => {
    const [branch] = await tx
      .select(businessFields)
      .from(businesses)
      .where(eq(businesses.id, branchId))
      .for('update')
      .limit(1);

    if (!branch || branch.user_id !== userId) {
      throw new BusinessError('Business not found', 404, 'NOT_FOUND');
    }
    if (branch.is_main) {
      throw new BusinessError('Only a branch needs approval', 409, 'NOT_A_BRANCH');
    }
    if (branch.branch_status === BRANCH_STATUS.ACTIVE) {
      throw new BusinessError('Branch is already active', 409, 'ALREADY_ACTIVE');
    }

    const rows = await tx
      .select()
      .from(branchApprovalOtps)
      .where(eq(branchApprovalOtps.branch_business_id, branchId));

    const latest = rows
      .filter(row => !row.consumed_at)
      .sort((a, b) => b.id - a.id)[0];

    if (
      !latest ||
      latest.expires_at.getTime() <= Date.now() ||
      latest.attempts >= OTP_MAX_ATTEMPTS
    ) {
      return { ok: false };
    }

    if (!sameHash(latest.otp_hash, hashOtp(branchId, otp))) {
      await tx
        .update(branchApprovalOtps)
        .set({ attempts: latest.attempts + 1 })
        .where(eq(branchApprovalOtps.id, latest.id));
      return { ok: false };
    }

    const now = new Date();
    await tx
      .update(branchApprovalOtps)
      .set({ consumed_at: now })
      .where(eq(branchApprovalOtps.id, latest.id));

    const [updated] = await tx
      .update(businesses)
      .set({ branch_status: BRANCH_STATUS.ACTIVE, updated_at: now })
      .where(eq(businesses.id, branchId))
      .returning(businessFields);

    return { ok: true, business: updated };
  });

  if (!outcome.ok) throw invalidOtp();

  logger.info(`Branch ${outcome.business.business_code} approved for user ${userId}`);
  return outcome.business;
};

// ── Read ────────────────────────────────────────────────────────────────────

export const getBusinessesForUser = async userId => {
  try {
    return await db
      .select(businessFields)
      .from(businesses)
      .where(eq(businesses.user_id, userId));
  } catch (e) {
    logger.error('Error getting businesses for user', e);
    throw e;
  }
};

export const getBusinessByIdForUser = async (userId, businessId) => {
  try {
    const [business] = await db
      .select(businessFields)
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found');
    return business;
  } catch (e) {
    if (e.message === 'Business not found') throw e;
    logger.error(`Error getting business ${businessId} for user ${userId}`, e);
    throw e;
  }
};

export const getBranchesForMainBusinessOwner = async (userId, businessId) => {
  try {
    const [mainBusiness] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(
        and(
          eq(businesses.id, businessId),
          eq(businesses.user_id, userId),
          eq(businesses.is_main, true)
        )
      )
      .limit(1);

    if (!mainBusiness) {
      throw new BusinessError('Business not found', 404, 'BUSINESS_NOT_FOUND');
    }

    const branches = await db
      .select({
        id: businesses.id,
        user_id: businesses.user_id,
        business_code: businesses.business_code,
        name: businesses.name,
        location: businesses.location,
        branch_status: businesses.branch_status,
        created_at: businesses.created_at,
      })
      .from(businesses)
      .where(eq(businesses.parent_business_id, businessId));

    return await Promise.all(
      branches.map(async branch => {
        const [owner] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, branch.user_id))
          .limit(1);

        if (!owner) {
          throw new Error(`Owner not found for branch ${branch.id}`);
        }

        return {
          id: branch.id,
          business_code: branch.business_code,
          name: branch.name,
          location: branch.location,
          branch_status: branch.branch_status,
          created_at: branch.created_at,
          owner_name: owner.name,
        };
      })
    );
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    logger.error(
      `Error getting branches for business ${businessId} and user ${userId}`,
      e
    );
    throw e;
  }
};

// ── Update ──────────────────────────────────────────────────────────────────

/**
 * Updates client-editable fields only. Server-managed fields are stripped
 * here as well as in the validation schema, so a caller that bypasses the
 * schema still can't change them.
 */
export const updateBusinessForUser = async (userId, businessId, updates) => {
  try {
    await getBusinessByIdForUser(userId, businessId);

    const writable = Object.fromEntries(
      Object.entries(updates).filter(
        ([key]) => !SERVER_MANAGED_FIELDS.includes(key)
      )
    );

    const [updated] = await db
      .update(businesses)
      .set({
        ...writable,
        updated_at: new Date(),
      })
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .returning(businessFields);

    logger.info(`Business ${updated.id} updated for user ${userId}`);
    return updated;
  } catch (e) {
    logger.error(`Error updating business ${businessId} for user ${userId}`, e);
    throw e;
  }
};
