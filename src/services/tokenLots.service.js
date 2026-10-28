/**
 * =============================================================================
 * tokenLots.service.js
 * =============================================================================
 * The only code that moves tokens. Every grant, spend and refund goes through
 * here, so wallets.balance_tokens always equals the sum of live lots.
 *
 * RULES
 * ─────
 * - Every function takes a transaction. Callers own the transaction boundary.
 * - The wallet row is locked (FOR UPDATE) before any balance change, so
 *   concurrent spends on one business run one at a time.
 * - Expiry is applied lazily inside every spend, so an expired trial token can
 *   never be spent, even if the hourly job hasn't run yet.
 * - Spending drains the soonest-expiring lot first; null expiry (purchased)
 *   comes last, and ties go to the oldest lot.
 * - A refund returns tokens to the lot they came from if that lot is still
 *   open. An expired trial lot's tokens are forfeited, never converted into
 *   purchased tokens.
 *
 * Trial expiry: end of the 7th calendar day after creation, Africa/Nairobi.
 * A business created Monday 14:00 keeps its trial until 23:59:59 EAT the
 * following Monday.
 * =============================================================================
 */

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { wallets, walletTransactions } from '#models/myWallet.model.js';
import {
  tokenLots,
  tokenLotConsumptions,
  TOKEN_SOURCES,
} from '#models/tokenLot.model.js';
import { eq } from 'drizzle-orm';
import {
  addBusinessDays,
  businessDayKey,
  endOfBusinessDay,
} from '#utils/businessDay.js';
import { isLedgerTokenAmount } from '#config/tokenPricing.js';

export const TRIAL_TOKENS = 200;
export const TRIAL_DAYS = 7;

export class InsufficientTokensError extends Error {
  constructor(required, available) {
    super(
      `Insufficient tokens. Required: ${required}, available: ${available}`
    );
    this.name = 'InsufficientTokensError';
    this.code = 'INSUFFICIENT_TOKENS';
    this.required = required;
    this.available = available;
  }
}

/** When a trial granted at createdAt expires. End of the 7th day, EAT. */
export const trialExpiryFor = (createdAt = new Date()) =>
  endOfBusinessDay(addBusinessDays(businessDayKey(createdAt), TRIAL_DAYS));

const assertWholeTokens = tokens => {
  if (!Number.isInteger(tokens) || tokens <= 0) {
    throw new Error(
      `Token amount must be a positive whole number, got ${tokens}`
    );
  }
};

const isExpired = (lot, now) =>
  lot.expires_at !== null &&
  lot.expires_at !== undefined &&
  new Date(lot.expires_at).getTime() <= now.getTime();

/** Lots still holding tokens, soonest expiry first, nulls last, then oldest. */
const spendOrder = (lots, now) =>
  lots
    .filter(lot => lot.tokens_remaining > 0 && !isExpired(lot, now))
    .sort((a, b) => {
      if (a.expires_at && b.expires_at) {
        const diff =
          new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
        return diff !== 0 ? diff : a.id - b.id;
      }
      if (a.expires_at) return -1;
      if (b.expires_at) return 1;
      return a.id - b.id;
    });

const sumOf = lots =>
  lots.reduce((total, lot) => total + lot.tokens_remaining, 0);

// ── Locking and reads ───────────────────────────────────────────────────────

/** Locks the business's wallet row. Every balance change starts here. */
export const lockWallet = async (tx, businessId) => {
  const [wallet] = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.business_id, businessId))
    .for('update')
    .limit(1);

  if (!wallet) throw new Error(`Wallet not found for business ${businessId}`);
  return wallet;
};

const lotsFor = (tx, businessId) =>
  tx
    .select()
    .from(tokenLots)
    .where(eq(tokenLots.business_id, businessId))
    .for('update');

const setBalance = (tx, wallet, balance) =>
  tx
    .update(wallets)
    .set({ balance_tokens: balance, updated_at: new Date() })
    .where(eq(wallets.id, wallet.id));

// ── Expiry ──────────────────────────────────────────────────────────────────

/**
 * Zeroes every lot past its expiry and takes those tokens off the balance.
 * Writes one 'expiry' ledger row. Mutates `wallet` so the caller sees the
 * new balance. Safe to call repeatedly.
 */
export const expireDueLots = async (tx, wallet, now = new Date()) => {
  const lots = await lotsFor(tx, wallet.business_id);
  let expired = 0;

  for (const lot of lots) {
    if (lot.tokens_remaining > 0 && isExpired(lot, now)) {
      expired += lot.tokens_remaining;
      await tx
        .update(tokenLots)
        .set({ tokens_remaining: 0 })
        .where(eq(tokenLots.id, lot.id));
    }
  }

  if (expired > 0) {
    await setBalance(tx, wallet, wallet.balance_tokens - expired);
    await tx.insert(walletTransactions).values({
      business_id: wallet.business_id,
      change_tokens: -expired,
      type: 'expiry',
      note: 'Trial tokens expired',
      created_at: now,
    });
    wallet.balance_tokens -= expired;
    logger.info('TOKENS_EXPIRED', { business_id: wallet.business_id, expired });
  }

  return expired;
};

// ── Grant ───────────────────────────────────────────────────────────────────

/**
 * Adds a lot and credits the balance. Used for trial grants, purchases and
 * manual additions. Caller passes the transaction.
 */
export const grantLot = async (
  tx,
  {
    businessId,
    source,
    tokens,
    expiresAt = null,
    txType,
    reference = null,
    note = null,
    createdBy = null,
    now = new Date(),
  }
) => {
  if (!isLedgerTokenAmount(tokens)) {
    throw new Error(
      `Token amount must be a positive multiple of 0.5, got ${tokens}`
    );
  }
  if (!Object.values(TOKEN_SOURCES).includes(source)) {
    throw new Error(`Unknown token source: ${source}`);
  }
  if ((source === TOKEN_SOURCES.TRIAL) !== (expiresAt !== null)) {
    throw new Error(
      'Only trial lots expire, and every trial lot must have an expiry'
    );
  }

  const wallet = await lockWallet(tx, businessId);

  const [lot] = await tx
    .insert(tokenLots)
    .values({
      business_id: businessId,
      source,
      tokens_initial: tokens,
      tokens_remaining: tokens,
      expires_at: expiresAt,
      note,
      created_at: now,
    })
    .returning();

  const balanceAfter = wallet.balance_tokens + tokens;
  await setBalance(tx, wallet, balanceAfter);

  const [walletTx] = await tx
    .insert(walletTransactions)
    .values({
      business_id: businessId,
      change_tokens: tokens,
      type: txType,
      reference,
      note,
      created_at: now,
      created_by: createdBy,
    })
    .returning();

  return { lot, walletTransactionId: walletTx.id, balanceAfter };
};

// ── Spend ───────────────────────────────────────────────────────────────────

/**
 * Takes `amount` tokens, soonest-expiring lot first. Writes one wallet
 * transaction and one consumption row per lot touched, so a refund can
 * reverse the exact lots.
 *
 * @throws {InsufficientTokensError} when the live balance is too low. Nothing
 *   is written in that case.
 */
export const spendTokens = async (
  tx,
  {
    businessId,
    amount,
    type = 'charge',
    reference = null,
    note = null,
    createdBy = null,
    now = new Date(),
  }
) => {
  assertWholeTokens(amount);

  const wallet = await lockWallet(tx, businessId);
  await expireDueLots(tx, wallet, now);

  const lots = spendOrder(await lotsFor(tx, businessId), now);
  const available = sumOf(lots);
  if (available < amount) {
    throw new InsufficientTokensError(amount, available);
  }

  const balanceAfter = wallet.balance_tokens - amount;
  await setBalance(tx, wallet, balanceAfter);

  const [walletTx] = await tx
    .insert(walletTransactions)
    .values({
      business_id: businessId,
      change_tokens: -amount,
      type,
      reference,
      note,
      created_at: now,
      created_by: createdBy,
    })
    .returning();

  const allocations = [];
  let remaining = amount;

  for (const lot of lots) {
    if (remaining === 0) break;
    const take = Math.min(lot.tokens_remaining, remaining);

    await tx
      .update(tokenLots)
      .set({ tokens_remaining: lot.tokens_remaining - take })
      .where(eq(tokenLots.id, lot.id));

    await tx.insert(tokenLotConsumptions).values({
      wallet_transaction_id: walletTx.id,
      lot_id: lot.id,
      tokens: take,
      created_at: now,
    });

    allocations.push({ lotId: lot.id, source: lot.source, tokens: take });
    remaining -= take;
  }

  return { walletTransactionId: walletTx.id, allocations, balanceAfter };
};

// ── Refund ──────────────────────────────────────────────────────────────────

/**
 * Reverses one spend. Each lot gets back the tokens it gave, if it is still
 * open. Tokens from an expired lot are forfeited, not moved to a purchase lot.
 * Each consumption row is refunded at most once.
 *
 * @returns {{ refunded: number, forfeited: number, balanceAfter: number,
 *   nothingToRefund: boolean }}
 */
export const refundWalletTransaction = async (
  tx,
  {
    businessId,
    walletTransactionId,
    reason = null,
    createdBy = null,
    now = new Date(),
  }
) => {
  const wallet = await lockWallet(tx, businessId);

  const rows = (
    await tx
      .select()
      .from(tokenLotConsumptions)
      .where(
        eq(tokenLotConsumptions.wallet_transaction_id, walletTransactionId)
      )
      .for('update')
  ).filter(row => !row.refunded_at);

  if (rows.length === 0) {
    return {
      refunded: 0,
      forfeited: 0,
      balanceAfter: wallet.balance_tokens,
      nothingToRefund: true,
    };
  }

  const lotsById = new Map(
    (await lotsFor(tx, businessId)).map(lot => [lot.id, lot])
  );

  let refunded = 0;
  let forfeited = 0;

  for (const row of rows) {
    const lot = lotsById.get(row.lot_id);
    const open = lot && !isExpired(lot, now);

    if (open) {
      await tx
        .update(tokenLots)
        .set({ tokens_remaining: lot.tokens_remaining + row.tokens })
        .where(eq(tokenLots.id, lot.id));
      lot.tokens_remaining += row.tokens;
      refunded += row.tokens;
    } else {
      forfeited += row.tokens;
    }

    await tx
      .update(tokenLotConsumptions)
      .set({ refunded_at: now })
      .where(eq(tokenLotConsumptions.id, row.id));
  }

  const balanceAfter = wallet.balance_tokens + refunded;
  await setBalance(tx, wallet, balanceAfter);

  const forfeitNote =
    forfeited > 0 ? `; ${forfeited} expired trial token(s) forfeited` : '';
  await tx.insert(walletTransactions).values({
    business_id: businessId,
    change_tokens: refunded,
    type: 'refund',
    reference: String(walletTransactionId),
    note: `${reason ?? 'Refund'}${forfeitNote}`,
    created_at: now,
    created_by: createdBy,
  });

  return { refunded, forfeited, balanceAfter, nothingToRefund: false };
};

// ── Reads ───────────────────────────────────────────────────────────────────

/** Spendable balance, with expiry applied first. Use this for any gate. */
export const getSpendableBalance = (businessId, now = new Date()) =>
  db.transaction(async tx => {
    const wallet = await lockWallet(tx, businessId);
    await expireDueLots(tx, wallet, now);
    return wallet.balance_tokens;
  });

/**
 * What the wallet endpoints return:
 *   { balance, trial: { remaining, expires_at } | null }
 * trial is null for a branch, or for a main created before trials existed.
 */
export const getWalletSummary = (businessId, now = new Date()) =>
  db.transaction(async tx => {
    const wallet = await lockWallet(tx, businessId);
    await expireDueLots(tx, wallet, now);

    const trial = (await lotsFor(tx, businessId)).find(
      lot => lot.source === TOKEN_SOURCES.TRIAL
    );

    return {
      balance: wallet.balance_tokens,
      trial: trial
        ? { remaining: trial.tokens_remaining, expires_at: trial.expires_at }
        : null,
    };
  });

// ── Consistency and repair ──────────────────────────────────────────────────

/**
 * Compares each wallet to its live lots, after applying expiry. Returns the
 * wallets that disagree. An empty array means the invariant holds.
 */
export const findWalletMismatches = async (now = new Date()) => {
  const all = await db.select().from(wallets);
  const mismatches = [];

  for (const { business_id } of all) {
    await db.transaction(async tx => {
      const wallet = await lockWallet(tx, business_id);
      await expireDueLots(tx, wallet, now);
      const live = sumOf(spendOrder(await lotsFor(tx, business_id), now));
      if (live !== wallet.balance_tokens) {
        mismatches.push({
          business_id,
          balance: wallet.balance_tokens,
          lots_total: live,
          difference: wallet.balance_tokens - live,
        });
      }
    });
  }

  return mismatches;
};

/**
 * Sets the balance to the sum of live lots and records the correction as a
 * 'repair' ledger row. The lots are the source of truth.
 */
export const repairWalletBalance = (businessId, now = new Date()) =>
  db.transaction(async tx => {
    const wallet = await lockWallet(tx, businessId);
    await expireDueLots(tx, wallet, now);

    const before = wallet.balance_tokens;
    const live = sumOf(spendOrder(await lotsFor(tx, businessId), now));
    const difference = live - before;

    if (difference !== 0) {
      await setBalance(tx, wallet, live);
      await tx.insert(walletTransactions).values({
        business_id: businessId,
        change_tokens: difference,
        type: 'repair',
        note: `Balance repaired from lots (was ${before}, lots total ${live})`,
        created_at: now,
      });
      logger.warn('TOKEN_BALANCE_REPAIRED', {
        business_id: businessId,
        before,
        after: live,
      });
    }

    return { business_id: businessId, before, after: live, difference };
  });
