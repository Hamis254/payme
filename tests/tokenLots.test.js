/**
 * Token lots: trial, purchased and manual tokens, spend order, expiry,
 * refunds, the day-5 and expiry-day warnings, and the balance invariant.
 *
 * Time is pinned with fake Date, but timers are left real, because the fake
 * database yields with setTimeout.
 */

jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('#config/database.js', () => ({
  db: { transaction: jest.fn(), select: jest.fn(), update: jest.fn() },
}));

jest.mock('#services/notification.service.js', () => ({
  notificationService: {
    createNotification: jest.fn(),
    sendDirectSMS: jest.fn(),
  },
}));

jest.mock('#utils/mpesa.js', () => ({
  initiateTokenPurchase: jest.fn(),
}));

jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  eq: (col, val) => ({ kind: 'eq', col, val }),
  and: (...conds) => ({ kind: 'and', conds }),
}));

import { db } from '#config/database.js';
import logger from '#config/logger.js';
import { notificationService } from '#services/notification.service.js';
import { initiateTokenPurchase as initiateMpesaTokenPurchase } from '#utils/mpesa.js';
import { installFake } from './helpers/fakeDb.js';
import {
  createBranchForUser,
  createBusinessForUser,
} from '#services/businesses.service.js';
import {
  findWalletMismatches,
  getSpendableBalance,
  getWalletSummary,
  grantLot,
  InsufficientTokensError,
  repairWalletBalance,
  refundWalletTransaction,
  spendTokens,
  trialExpiryFor,
} from '#services/tokenLots.service.js';
import { runTokenLotCycle } from '#services/tokenLotScheduler.js';
import { TOKEN_SOURCES } from '#models/tokenLot.model.js';
import { kesToTokens } from '#config/tokenPricing.js';
import {
  initiateTokenPurchase as initiateWalletServicePurchase,
  processTokenPurchaseCallback as processWalletServiceCallback,
} from '#services/wallet.service.js';
import {
  initiateTokenPurchase as initiateMyWalletServicePurchase,
  processTokenPurchaseCallback as processMyWalletServiceCallback,
} from '#services/myWallet.service.js';
import { getTokenPackagesHandler } from '#controllers/wallet.controller.js';

// Monday 26 Oct 2026, 14:00 Nairobi. The trial runs to the end of Monday 2 Nov.
const CREATED = new Date('2026-10-26T14:00:00+03:00');
const EXPIRY = new Date('2026-11-02T23:59:59.999+03:00');
const AFTER_EXPIRY = new Date('2026-11-03T00:30:00+03:00');
const DAY5_MORNING = new Date('2026-10-31T09:00:00+03:00');
const DAY7_MORNING = new Date('2026-11-02T08:00:00+03:00');

const OWNER = 1;
const PHONE = '+254700000001';

const mainData = {
  name: 'Protopulse technologies',
  location: 'Nairobi',
  payment_method: 'till_number',
  payment_identifier: '123456',
};

const branchData = mainCode => ({
  name: 'Branch',
  location: 'Westlands',
  payment_method: 'till_number',
  payment_identifier: '654321',
  main_business_code: mainCode,
});

const rejectionOf = promise =>
  promise.then(
    () => {
      throw new Error('expected rejection');
    },
    err => err
  );

const lotsOf = (fake, businessId) =>
  fake.store.token_lots
    .filter(lot => lot.business_id === businessId)
    .sort((a, b) => a.id - b.id);

const walletOf = (fake, businessId) =>
  fake.store.wallets.find(w => w.business_id === businessId);

/** Creates a main owned by OWNER with a phone, and returns it. */
const createMain = async fake => {
  fake.store.users.push({ id: OWNER, name: 'owner', phone_number: PHONE });
  return createBusinessForUser(OWNER, mainData);
};

/** Runs a token operation in its own transaction. */
const inTx = (fn, ...args) => db.transaction(tx => fn(tx, ...args));

beforeEach(() => {
  jest.clearAllMocks();
  notificationService.createNotification.mockResolvedValue({ id: 1 });
  initiateMpesaTokenPurchase.mockResolvedValue({
    CheckoutRequestID: 'test-checkout-request',
  });
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'],
  });
  jest.setSystemTime(CREATED);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Fractional token purchases ──────────────────────────────────────────────

describe('fractional token purchases', () => {
  it('KES 25 converts to exactly 12.5 tokens', () => {
    expect(kesToTokens(25)).toBe(12.5);
  });

  it('KES 25 grants 12.5 tokens in one lot and spending 1 leaves 11.5', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    const grant = await inTx(grantLot, {
      businessId: main.id,
      source: TOKEN_SOURCES.PURCHASE,
      tokens: kesToTokens(25),
      txType: 'purchase',
    });

    expect(grant.balanceAfter).toBe(212.5);
    expect(lotsOf(fake, main.id).at(-1)).toMatchObject({
      tokens_initial: 12.5,
      tokens_remaining: 12.5,
    });
    expect(walletOf(fake, main.id).balance_tokens).toBe(212.5);
    await expect(
      inTx(spendTokens, { businessId: main.id, amount: 0.5 })
    ).rejects.toThrow(/positive whole number/);

    await inTx(spendTokens, {
      businessId: main.id,
      amount: 1,
      now: AFTER_EXPIRY,
    });
    expect(lotsOf(fake, main.id).at(-1).tokens_remaining).toBe(11.5);
    expect(walletOf(fake, main.id).balance_tokens).toBe(11.5);
  });

  it.each([
    ['wallet service', initiateWalletServicePurchase],
    ['my-wallet service', initiateMyWalletServicePurchase],
  ])(
    '%s charges custom KES exactly and stores its token amount',
    async (_name, initiate) => {
      const fake = installFake(db);
      const main = await createMain(fake);

      const result = await initiate(OWNER, main.id, {
        amount: 50,
        phone: PHONE,
      });

      expect(initiateMpesaTokenPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 50 })
      );
      expect(result).toMatchObject({
        packageType: 'custom',
        amount: 50,
        tokens: 25,
      });
      expect(fake.store.token_purchases.at(-1)).toMatchObject({
        package_type: 'custom',
        amount_paid: '50',
        tokens_purchased: 25,
      });
    }
  );

  it.each([
    [
      'wallet service',
      initiateWalletServicePurchase,
      processWalletServiceCallback,
    ],
    [
      'my-wallet service',
      initiateMyWalletServicePurchase,
      processMyWalletServiceCallback,
    ],
  ])(
    '%s grants the custom purchase only when callback amount matches',
    async (_name, initiate, processCallback) => {
      const fake = installFake(db);
      const main = await createMain(fake);
      initiateMpesaTokenPurchase
        .mockResolvedValueOnce({ CheckoutRequestID: 'mismatch-checkout' })
        .mockResolvedValueOnce({ CheckoutRequestID: 'matching-checkout' });
      await initiate(OWNER, main.id, { amount: 50, phone: PHONE });

      await processCallback({
        CheckoutRequestID: 'mismatch-checkout',
        ResultCode: 0,
        CallbackMetadata: {
          Item: [{ Name: 'Amount', Value: 49 }],
        },
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Token purchase callback amount mismatch',
        expect.any(Object)
      );
      expect(fake.store.token_purchases.at(-1).status).toBe('failed');
      expect(lotsOf(fake, main.id)).toHaveLength(1);
      expect(walletOf(fake, main.id).balance_tokens).toBe(200);

      await initiate(OWNER, main.id, { amount: 50, phone: PHONE });
      await processCallback({
        CheckoutRequestID: 'matching-checkout',
        ResultCode: 0,
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 50 },
            { Name: 'MpesaReceiptNumber', Value: 'RCP001' },
          ],
        },
      });

      expect(fake.store.token_purchases.at(-1).status).toBe('success');
      expect(lotsOf(fake, main.id).at(-1)).toMatchObject({
        tokens_initial: 25,
        tokens_remaining: 25,
      });
      expect(fake.store.wallet_transactions.at(-1).note).toContain(
        'Token purchase - custom top-up'
      );
    }
  );

  it.each([
    ['wallet service', initiateWalletServicePurchase],
    ['my-wallet service', initiateMyWalletServicePurchase],
  ])('%s keeps the fixed token count for packages', async (_name, initiate) => {
    const fake = installFake(db);
    const main = await createMain(fake);

    const result = await initiate(OWNER, main.id, {
      packageType: '1500',
      phone: PHONE,
    });

    expect(initiateMpesaTokenPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1200 })
    );
    expect(result).toMatchObject({
      packageType: '1500',
      amount: 1200,
      tokens: 1300,
    });
    expect(fake.store.token_purchases.at(-1)).toMatchObject({
      package_type: '1500',
      amount_paid: '1200',
      tokens_purchased: 1300,
    });
  });

  it('wallet package metadata describes the custom purchase limits', async () => {
    const res = {
      json: jest.fn(),
    };

    await getTokenPackagesHandler({}, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        customPurchase: {
          minKes: 50,
          maxKes: 100_000,
          kesPerToken: 2,
        },
      })
    );
  });
});

// ── Grant on creation ───────────────────────────────────────────────────────

describe('trial grant on main creation', () => {
  it('a new main gets 200 trial tokens that expire at the end of day 7 (EAT)', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    const [lot] = lotsOf(fake, main.id);
    expect(lot.source).toBe(TOKEN_SOURCES.TRIAL);
    expect(lot.tokens_initial).toBe(200);
    expect(lot.tokens_remaining).toBe(200);
    expect(new Date(lot.expires_at).getTime()).toBe(EXPIRY.getTime());
    expect(walletOf(fake, main.id).balance_tokens).toBe(200);

    const grant = fake.store.wallet_transactions.find(
      t => t.type === 'trial_grant'
    );
    expect(grant.change_tokens).toBe(200);
  });

  it('the expiry rule is end of the 7th calendar day, not 7x24 hours', () => {
    // Created at 23:30 on the 26th still ends on the 2nd.
    const late = new Date('2026-10-26T23:30:00+03:00');
    expect(trialExpiryFor(late).getTime()).toBe(EXPIRY.getTime());
  });

  it('a branch gets no trial and a zero balance', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    const { business } = await createBranchForUser(
      OWNER,
      branchData(main.business_code)
    );

    expect(lotsOf(fake, business.id)).toHaveLength(0);
    expect(walletOf(fake, business.id).balance_tokens).toBe(0);
    expect(
      fake.store.wallet_transactions.some(
        t => t.business_id === business.id && t.type === 'trial_grant'
      )
    ).toBe(false);

    const summary = await getWalletSummary(business.id);
    expect(summary).toEqual({ balance: 0, trial: null });
  });

  it('the wallet summary reports the trial remaining and expiry', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    const summary = await getWalletSummary(main.id);

    expect(summary.balance).toBe(200);
    expect(summary.trial.remaining).toBe(200);
    expect(new Date(summary.trial.expires_at).getTime()).toBe(EXPIRY.getTime());
  });
});

// ── Spend order ─────────────────────────────────────────────────────────────

describe('spend order', () => {
  it('trial tokens are spent before purchased tokens', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    await inTx(grantLot, {
      businessId: main.id,
      source: TOKEN_SOURCES.PURCHASE,
      tokens: 30,
      txType: 'purchase',
    });

    await inTx(spendTokens, { businessId: main.id, amount: 150 });

    const [trial, purchase] = lotsOf(fake, main.id);
    expect(trial.tokens_remaining).toBe(50);
    expect(purchase.tokens_remaining).toBe(30);

    await inTx(spendTokens, { businessId: main.id, amount: 60 });

    expect(lotsOf(fake, main.id)[0].tokens_remaining).toBe(0);
    expect(lotsOf(fake, main.id)[1].tokens_remaining).toBe(20);
    expect(walletOf(fake, main.id).balance_tokens).toBe(20);
  });

  it('purchased and manual lots never expire, so expiry is null', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    await inTx(grantLot, {
      businessId: main.id,
      source: TOKEN_SOURCES.MANUAL,
      tokens: 10,
      txType: 'purchase',
    });

    const manual = lotsOf(fake, main.id).find(l => l.source === 'manual');
    expect(manual.expires_at).toBeNull();
  });
});

// ── Expiry ──────────────────────────────────────────────────────────────────

describe('expiry', () => {
  it('an expired trial lot cannot be spent', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    jest.setSystemTime(AFTER_EXPIRY);

    const err = await rejectionOf(
      inTx(spendTokens, { businessId: main.id, amount: 1, now: AFTER_EXPIRY })
    );

    expect(err).toBeInstanceOf(InsufficientTokensError);
    expect(err.available).toBe(0);
  });

  it('expired trial tokens are not spent even when purchased tokens are there', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    await inTx(grantLot, {
      businessId: main.id,
      source: TOKEN_SOURCES.PURCHASE,
      tokens: 30,
      txType: 'purchase',
    });
    jest.setSystemTime(AFTER_EXPIRY);

    const err = await rejectionOf(
      inTx(spendTokens, { businessId: main.id, amount: 31, now: AFTER_EXPIRY })
    );
    expect(err.available).toBe(30);

    await inTx(spendTokens, {
      businessId: main.id,
      amount: 30,
      now: AFTER_EXPIRY,
    });
    expect(lotsOf(fake, main.id)[0].tokens_remaining).toBe(0);
    expect(walletOf(fake, main.id).balance_tokens).toBe(0);
  });

  it('reading the spendable balance applies expiry, even before the job runs', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    // Still inside the window, one minute before the trial ends.
    const lastMinute = new Date('2026-11-02T23:59:00+03:00');
    expect(await getSpendableBalance(main.id, lastMinute)).toBe(200);
    expect(await getSpendableBalance(main.id, AFTER_EXPIRY)).toBe(0);
    expect(fake.store.wallet_transactions.some(t => t.type === 'expiry')).toBe(
      true
    );
  });

  it('the hourly cycle zeroes expired lots and reduces the balance once', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    const first = await runTokenLotCycle(AFTER_EXPIRY);
    expect(first.expiredTokens).toBe(200);
    expect(lotsOf(fake, main.id)[0].tokens_remaining).toBe(0);
    expect(walletOf(fake, main.id).balance_tokens).toBe(0);

    const second = await runTokenLotCycle(AFTER_EXPIRY);
    expect(second.expiredTokens).toBe(0);
    expect(
      fake.store.wallet_transactions.filter(t => t.type === 'expiry')
    ).toHaveLength(1);
  });
});

// ── Refunds ─────────────────────────────────────────────────────────────────

describe('refunds', () => {
  it('a refund returns tokens to the trial lot they came from while it is open', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    const spend = await inTx(spendTokens, { businessId: main.id, amount: 50 });

    const result = await inTx(refundWalletTransaction, {
      businessId: main.id,
      walletTransactionId: spend.walletTransactionId,
    });

    expect(result).toMatchObject({
      refunded: 50,
      forfeited: 0,
      balanceAfter: 200,
    });
    expect(lotsOf(fake, main.id)[0].tokens_remaining).toBe(200);
  });

  it('an expired trial token is forfeited, never moved to purchased', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    const spend = await inTx(spendTokens, { businessId: main.id, amount: 50 });

    const result = await inTx(refundWalletTransaction, {
      businessId: main.id,
      walletTransactionId: spend.walletTransactionId,
      now: AFTER_EXPIRY,
    });

    expect(result.refunded).toBe(0);
    expect(result.forfeited).toBe(50);
    expect(lotsOf(fake, main.id).some(l => l.source === 'purchase')).toBe(
      false
    );
    // The 50 spent stay spent: the remaining 150 are the only balance.
    expect(walletOf(fake, main.id).balance_tokens).toBe(150);
  });

  it('a spend is refunded at most once', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    const spend = await inTx(spendTokens, { businessId: main.id, amount: 5 });
    await inTx(refundWalletTransaction, {
      businessId: main.id,
      walletTransactionId: spend.walletTransactionId,
    });

    const again = await inTx(refundWalletTransaction, {
      businessId: main.id,
      walletTransactionId: spend.walletTransactionId,
    });

    expect(again.nothingToRefund).toBe(true);
    expect(walletOf(fake, main.id).balance_tokens).toBe(200);
  });
});

// ── Double grant ────────────────────────────────────────────────────────────

describe('double grant', () => {
  it('a second trial grant for the same business is refused by the database', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    const err = await rejectionOf(
      inTx(grantLot, {
        businessId: main.id,
        source: TOKEN_SOURCES.TRIAL,
        tokens: 200,
        expiresAt: EXPIRY,
        txType: 'trial_grant',
      })
    );

    expect(err.cause.constraint).toBe('idx_token_lots_trial_once');
    expect(
      lotsOf(fake, main.id).filter(l => l.source === 'trial')
    ).toHaveLength(1);
    expect(walletOf(fake, main.id).balance_tokens).toBe(200);
  });

  it('a trial lot without an expiry, or a purchase lot with one, is rejected', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    await expect(
      inTx(grantLot, {
        businessId: main.id,
        source: TOKEN_SOURCES.PURCHASE,
        tokens: 5,
        expiresAt: EXPIRY,
        txType: 'purchase',
      })
    ).rejects.toThrow(/Only trial lots expire/);
  });
});

// ── Balance invariant ───────────────────────────────────────────────────────

describe('balance equals the sum of live lots', () => {
  it('reports and repairs a mismatch without rounding fractional tokens', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    await inTx(grantLot, {
      businessId: main.id,
      source: TOKEN_SOURCES.PURCHASE,
      tokens: 12.5,
      txType: 'purchase',
    });
    walletOf(fake, main.id).balance_tokens = 999.5;

    expect(await findWalletMismatches(CREATED)).toEqual([
      {
        business_id: main.id,
        balance: 999.5,
        lots_total: 212.5,
        difference: 787,
      },
    ]);

    const repaired = await repairWalletBalance(main.id, CREATED);
    expect(repaired).toMatchObject({ before: 999.5, after: 212.5 });
    expect(walletOf(fake, main.id).balance_tokens).toBe(212.5);
    expect(await findWalletMismatches(CREATED)).toEqual([]);
  });

  it('holds after a mix of grants, spends and refunds', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    await inTx(grantLot, {
      businessId: main.id,
      source: TOKEN_SOURCES.PURCHASE,
      tokens: 40,
      txType: 'purchase',
    });
    const spend = await inTx(spendTokens, { businessId: main.id, amount: 210 });
    await inTx(refundWalletTransaction, {
      businessId: main.id,
      walletTransactionId: spend.walletTransactionId,
    });

    expect(await findWalletMismatches(CREATED)).toEqual([]);
  });

  it('a wallet balance that drifts from its lots is reported, then repaired', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    walletOf(fake, main.id).balance_tokens = 999;

    const mismatches = await findWalletMismatches(CREATED);
    expect(mismatches).toEqual([
      { business_id: main.id, balance: 999, lots_total: 200, difference: 799 },
    ]);

    const repaired = await repairWalletBalance(main.id, CREATED);
    expect(repaired).toMatchObject({
      before: 999,
      after: 200,
      difference: -799,
    });
    expect(fake.store.wallet_transactions.some(t => t.type === 'repair')).toBe(
      true
    );
    expect(await findWalletMismatches(CREATED)).toEqual([]);
  });
});

// ── Concurrency ─────────────────────────────────────────────────────────────

describe('concurrent spends', () => {
  it('two simultaneous spends of the last token: exactly one succeeds', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    await inTx(spendTokens, { businessId: main.id, amount: 199 });

    const settled = await Promise.allSettled([
      inTx(spendTokens, { businessId: main.id, amount: 1 }),
      inTx(spendTokens, { businessId: main.id, amount: 1 }),
    ]);

    expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(1);
    expect(walletOf(fake, main.id).balance_tokens).toBe(0);
  });

  it('control: without the wallet lock, both spends succeed and overdraw', async () => {
    const fake = installFake(db, { lockingEnabled: false });
    const main = await createMain(fake);
    await inTx(spendTokens, { businessId: main.id, amount: 199 });

    const settled = await Promise.allSettled([
      inTx(spendTokens, { businessId: main.id, amount: 1 }),
      inTx(spendTokens, { businessId: main.id, amount: 1 }),
    ]);

    expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(2);
  });
});

// ── Warnings ────────────────────────────────────────────────────────────────

describe('day-5 and expiry-day warnings', () => {
  it('each warning is sent once, at the right day, to the main owner', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);

    // Before day 5: nothing.
    await runTokenLotCycle(new Date('2026-10-30T12:00:00+03:00'));
    expect(notificationService.createNotification).not.toHaveBeenCalled();

    await runTokenLotCycle(DAY5_MORNING);
    expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: OWNER,
        type: 'trial_warning_day5',
        related_type: 'token_lot',
      })
    );

    // Re-running the same day doesn't resend.
    await runTokenLotCycle(DAY5_MORNING);
    expect(notificationService.createNotification).toHaveBeenCalledTimes(1);

    await runTokenLotCycle(DAY7_MORNING);
    expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
    expect(notificationService.createNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'trial_expiring_today' })
    );
    expect(lotsOf(fake, main.id)[0].notice_expiry_sent_at).toBeInstanceOf(Date);
  });

  it('a failed send is retried on the next cycle, not lost', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    notificationService.createNotification.mockRejectedValueOnce(
      new Error('gateway down')
    );

    await runTokenLotCycle(DAY5_MORNING);
    expect(lotsOf(fake, main.id)[0].notice_day5_sent_at).toBeNull();

    await runTokenLotCycle(DAY5_MORNING);
    expect(lotsOf(fake, main.id)[0].notice_day5_sent_at).toBeInstanceOf(Date);
  });
});

// ── Branches get nothing and must buy ───────────────────────────────────────

describe('a branch starts with zero tokens and must buy before it can sell', () => {
  it('the payment gate reads 0 for a branch, and a spend is refused', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    const { business: branch } = await createBranchForUser(
      OWNER,
      branchData(main.business_code)
    );

    expect(await getSpendableBalance(branch.id, CREATED)).toBe(0);

    const err = await rejectionOf(
      inTx(spendTokens, { businessId: branch.id, amount: 1, now: CREATED })
    );
    expect(err).toBeInstanceOf(InsufficientTokensError);
    expect(err.available).toBe(0);
  });

  it('after a purchase, the branch can spend exactly what it bought', async () => {
    const fake = installFake(db);
    const main = await createMain(fake);
    const { business: branch } = await createBranchForUser(
      OWNER,
      branchData(main.business_code)
    );
    await inTx(grantLot, {
      businessId: branch.id,
      source: TOKEN_SOURCES.PURCHASE,
      tokens: 30,
      txType: 'purchase',
    });

    await inTx(spendTokens, {
      businessId: branch.id,
      amount: 30,
      now: CREATED,
    });

    expect(walletOf(fake, branch.id).balance_tokens).toBe(0);
    expect(lotsOf(fake, main.id)[0].tokens_remaining).toBe(200);
  });
});
