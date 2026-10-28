/**
 * Main/branch business model.
 *
 * The database is an in-process fake that implements just the drizzle calls
 * the service uses. It has per-transaction rollback and a FOR UPDATE lock
 * that serializes transactions. The lock is per table here, which is coarser
 * than Postgres's row lock, but it is enough to test the allocation logic.
 * The lockingEnabled:false control shows the race is real without the lock.
 */

jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('#config/database.js', () => ({
  db: { transaction: jest.fn(), select: jest.fn(), update: jest.fn() },
}));

jest.mock('#services/notification.service.js', () => ({
  notificationService: { sendDirectSMS: jest.fn() },
}));

jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  eq: (col, val) => ({ kind: 'eq', col, val }),
  and: (...conds) => ({ kind: 'and', conds }),
}));

import { db } from '#config/database.js';
import { notificationService } from '#services/notification.service.js';
import {
  approveBranchForUser,
  BusinessError,
  createBranchForUser,
  createBusinessForUser,
  MAX_OTP_ISSUES,
  OTP_MAX_ATTEMPTS,
  resendBranchApprovalForUser,
  updateBusinessForUser,
} from '#services/businesses.service.js';
import { installFake as installFakeDb } from './helpers/fakeDb.js';
import { validateBusinessId } from '#middleware/businessId.middleware.js';
import { branchLookupLimiter } from '#middleware/rateLimiter.middleware.js';
import { createBusiness } from '#controllers/businesses.controller.js';
import { updateBusinessSchema } from '#validations/businesses.validation.js';

// The fake database lives in tests/helpers/fakeDb.js so every token and
// business test shares one model of the tables.
const installFake = options => installFakeDb(db, options);

// ── Helpers ─────────────────────────────────────────────────────────────────

const mainData = (name = 'Protopulse technologies') => ({
  name,
  location: 'Nairobi',
  payment_method: 'till_number',
  payment_identifier: '123456',
});

const branchData = (mainCode, name = 'Branch') => ({
  name,
  location: 'Westlands',
  payment_method: 'till_number',
  payment_identifier: '654321',
  main_business_code: mainCode,
});

const addUser = (fake, id, phone) =>
  fake.store.users.push({ id, name: `user ${id}`, phone_number: phone });

// The OTP is only ever in the SMS body, so the test reads it from there.
// Returns the most recent code, since a resend texts the same phone again.
const otpSentTo = phone => {
  const call = notificationService.sendDirectSMS.mock.calls
    .filter(([to]) => to === phone)
    .at(-1);
  return call?.[1].match(/Code: (\d{6})/)[1];
};

const rejectionOf = promise =>
  promise.then(
    () => {
      throw new Error('expected rejection');
    },
    err => err
  );

const OWNER = 1;
const OTHER = 2;
const MAIN_OWNER_PHONE = '+254700000001';
const OTHER_PHONE = '+254700000002';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-for-branch-otp';
});

beforeEach(() => {
  jest.clearAllMocks();
  notificationService.sendDirectSMS.mockResolvedValue(true);
});

// ── Main codes ──────────────────────────────────────────────────────────────

describe('main business code', () => {
  it('a main gets a server-generated <3 letters><4 digits> code', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);

    const main = await createBusinessForUser(OWNER, mainData());

    expect(main.business_code).toMatch(/^PRO\d{4}$/);
    expect(main.is_main).toBe(true);
    expect(main.parent_business_id).toBeNull();
    expect(main.branch_status).toBe('active');
    expect(fake.store.wallets.filter(w => w.business_id === main.id)).toHaveLength(1);
  });

  it('a client-supplied business_code is refused at the controller', async () => {
    installFake();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createBusiness(
      {
        user: { id: OWNER, email: 'o@example.com' },
        body: { ...mainData(), business_code: 'FAKE0001' },
      },
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/assigned by the server/);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── Branch sequencing ───────────────────────────────────────────────────────

describe('branch codes under concurrent creation', () => {
  it('five simultaneous same-owner branches get -1 through -5, each once', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(i =>
        createBranchForUser(OWNER, branchData(main.business_code, `Branch ${i}`))
      )
    );

    const codes = results.map(r => r.business.business_code).sort();
    expect(codes).toEqual([1, 2, 3, 4, 5].map(n => `${main.business_code}-${n}`));

    const sequences = fake.store.businesses
      .filter(b => b.parent_business_id === main.id)
      .map(b => b.branch_sequence)
      .sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5]);

    for (const { business } of results) {
      expect(business.is_main).toBe(false);
      expect(business.parent_business_id).toBe(main.id);
      expect(business.branch_status).toBe('active');
    }
  });

  it('control: without the parent lock, simultaneous branches collide', async () => {
    // Same scenario with locking off. Every transaction reads the same
    // sibling max before any insert, so the (parent, sequence) unique index
    // must reject some of them. This shows the lock is what prevents it.
    const fake = installFake({ lockingEnabled: false });
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());

    const settled = await Promise.allSettled(
      [1, 2, 3, 4, 5].map(i =>
        createBranchForUser(OWNER, branchData(main.business_code, `Branch ${i}`))
      )
    );

    const failures = settled.filter(s => s.status === 'rejected');
    expect(failures.length).toBeGreaterThan(0);
    // Two unique indexes can catch this. The branch code is derived from the
    // sequence, so colliding sequences also collide on business_code.
    expect([
      'businesses_business_code_unique',
      'idx_businesses_parent_branch_sequence',
    ]).toContain(failures[0].reason.cause.constraint);
  });
});

// ── Foreign main and OTP ────────────────────────────────────────────────────

describe('branch of another user\'s main', () => {
  it('is created pending and an OTP is texted to the main owner', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());

    const { business, otp_sent } = await createBranchForUser(
      OTHER,
      branchData(main.business_code)
    );

    expect(business.branch_status).toBe('pending_approval');
    expect(otp_sent).toBe(true);
    expect(notificationService.sendDirectSMS).toHaveBeenCalledWith(
      MAIN_OWNER_PHONE,
      expect.stringMatching(/Code: \d{6}\./)
    );

    // Only the keyed hash is stored, never the code.
    const [otpRow] = fake.store.branch_approval_otps;
    expect(otpRow.branch_business_id).toBe(business.id);
    expect(otpRow.otp_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(otpRow.otp_hash).not.toContain(otpSentTo(MAIN_OWNER_PHONE));
  });

  it('a pending branch stays pending until the right code is entered', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    const { business } = await createBranchForUser(OTHER, branchData(main.business_code));
    const code = otpSentTo(MAIN_OWNER_PHONE);

    const wrong = code === '000000' ? '111111' : '000000';
    const err = await rejectionOf(approveBranchForUser(OTHER, business.id, wrong));
    expect(err).toBeInstanceOf(BusinessError);
    expect(err.message).toBe('Invalid or expired code');

    const branch = fake.store.businesses.find(b => b.id === business.id);
    expect(branch.branch_status).toBe('pending_approval');
    expect(fake.store.branch_approval_otps[0].attempts).toBe(1);

    const approved = await approveBranchForUser(OTHER, business.id, code);
    expect(approved.branch_status).toBe('active');
    expect(fake.store.branch_approval_otps[0].consumed_at).toBeInstanceOf(Date);

    // A consumed code can't be reused.
    const reuse = await rejectionOf(approveBranchForUser(OTHER, business.id, code));
    expect(reuse.statusCode).toBe(409);
  });

  it('locks the OTP after too many wrong guesses, even with the right code', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    const { business } = await createBranchForUser(OTHER, branchData(main.business_code));
    const code = otpSentTo(MAIN_OWNER_PHONE);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await rejectionOf(approveBranchForUser(OTHER, business.id, wrong));
    }

    // The attempt count is a committed write, so the lockout survives
    // the failed transactions.
    const err = await rejectionOf(approveBranchForUser(OTHER, business.id, code));
    expect(err.message).toBe('Invalid or expired code');
    expect(fake.store.businesses.find(b => b.id === business.id).branch_status).toBe(
      'pending_approval'
    );
  });

  it('only the user who requested the branch can submit its code', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    const { business } = await createBranchForUser(OTHER, branchData(main.business_code));
    const code = otpSentTo(MAIN_OWNER_PHONE);

    const err = await rejectionOf(approveBranchForUser(OWNER, business.id, code));
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Business not found');
  });

  it('a same-owner branch is active immediately with no OTP', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());

    const { business, otp_sent } = await createBranchForUser(
      OWNER,
      branchData(main.business_code)
    );

    expect(business.branch_status).toBe('active');
    expect(otp_sent).toBe(false);
    expect(notificationService.sendDirectSMS).not.toHaveBeenCalled();
    expect(fake.store.branch_approval_otps).toHaveLength(0);
  });
});

// ── Refused lookups ─────────────────────────────────────────────────────────

describe('refused main codes', () => {
  it('a branch code, an unknown code and a branch-of-branch all get the same error', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    await createBranchForUser(OWNER, branchData(main.business_code));
    const branchCode = `${main.business_code}-1`;

    const attempts = [
      'ZZZ9999', // no such code
      branchCode, // a branch, so not a valid parent
      branchCode.toLowerCase(), // same, with the case changed
    ];

    const errors = [];
    for (const code of attempts) {
      errors.push(await rejectionOf(createBranchForUser(OTHER, branchData(code))));
    }

    for (const err of errors) {
      expect(err).toBeInstanceOf(BusinessError);
      expect(err.message).toBe('Main business code is not valid');
      expect(err.code).toBe('INVALID_MAIN_CODE');
    }
    // No branch was created from any of them.
    expect(fake.store.businesses.filter(b => !b.is_main)).toHaveLength(1);
  });

  it('a main whose owner has no phone is refused with the same generic error', async () => {
    const fake = installFake();
    addUser(fake, OWNER, null);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());

    const err = await rejectionOf(
      createBranchForUser(OTHER, branchData(main.business_code))
    );

    expect(err.message).toBe('Main business code is not valid');
    // The failed transaction rolls back the branch row and its wallet.
    expect(fake.store.businesses.filter(b => !b.is_main)).toHaveLength(0);
    expect(fake.store.wallets).toHaveLength(1);
  });
});

// ── Read-only fields ────────────────────────────────────────────────────────

describe('business code and tree fields are read-only after creation', () => {
  it('update strips server-managed fields and leaves them unchanged', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    const { business } = await createBranchForUser(OTHER, branchData(main.business_code));

    await updateBusinessForUser(OTHER, business.id, {
      name: 'Renamed branch',
      business_code: 'HACKED-9',
      is_main: true,
      parent_business_id: null,
      branch_sequence: 99,
      branch_status: 'active',
    });

    const row = fake.store.businesses.find(b => b.id === business.id);
    expect(row.name).toBe('Renamed branch');
    expect(row.business_code).toBe(`${main.business_code}-1`);
    expect(row.is_main).toBe(false);
    expect(row.parent_business_id).toBe(main.id);
    expect(row.branch_sequence).toBe(1);
    expect(row.branch_status).toBe('pending_approval');
  });

  it('the update schema has no field for any server-managed key', () => {
    const parsed = updateBusinessSchema.parse({
      name: 'Renamed',
      business_code: 'HACKED-9',
      is_main: false,
      branch_status: 'active',
    });

    expect(parsed).toEqual({ name: 'Renamed' });
  });
});

// ── Pending branches are blocked from acting as a business ──────────────────

describe('pending branch access', () => {
  it('businessId middleware refuses a pending branch and admits an active one', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    const { business: pending } = await createBranchForUser(OTHER, branchData(main.business_code));
    const { business: active } = await createBranchForUser(OWNER, branchData(main.business_code));

    const run = async id => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      await validateBusinessId('params')(
        { params: { businessId: id }, user: { id: id === pending.id ? OTHER : OWNER } },
        res,
        next
      );
      return { res, next };
    };

    const blocked = await run(pending.id);
    expect(blocked.res.status).toHaveBeenCalledWith(403);
    expect(blocked.next).not.toHaveBeenCalled();

    const allowed = await run(active.id);
    expect(allowed.next).toHaveBeenCalled();
  });
});

// ── Resend ──────────────────────────────────────────────────────────────────

describe('resend branch approval code', () => {
  const setupPending = async fake => {
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    addUser(fake, OTHER, OTHER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    const { business } = await createBranchForUser(OTHER, branchData(main.business_code));
    return { main, branch: business };
  };

  it('issues a new code and the old one stops working', async () => {
    const fake = installFake();
    const { branch } = await setupPending(fake);
    const oldCode = otpSentTo(MAIN_OWNER_PHONE);

    const { otp_sent } = await resendBranchApprovalForUser(OTHER, branch.id);
    expect(otp_sent).toBe(true);
    const newCode = otpSentTo(MAIN_OWNER_PHONE);
    expect(newCode).toMatch(/^\d{6}$/);

    if (newCode !== oldCode) {
      const stale = await rejectionOf(approveBranchForUser(OTHER, branch.id, oldCode));
      expect(stale.message).toBe('Invalid or expired code');
    }

    const approved = await approveBranchForUser(OTHER, branch.id, newCode);
    expect(approved.branch_status).toBe('active');
  });

  it('refuses a resend for an active branch', async () => {
    const fake = installFake();
    addUser(fake, OWNER, MAIN_OWNER_PHONE);
    const main = await createBusinessForUser(OWNER, mainData());
    const { business } = await createBranchForUser(OWNER, branchData(main.business_code));

    const err = await rejectionOf(resendBranchApprovalForUser(OWNER, business.id));
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Branch is already active');
  });

  it('only the requester can resend', async () => {
    const fake = installFake();
    const { branch } = await setupPending(fake);

    const err = await rejectionOf(resendBranchApprovalForUser(OWNER, branch.id));
    expect(err.statusCode).toBe(404);
    expect(fake.store.branch_approval_otps).toHaveLength(1);
  });

  it('caps the codes issued per branch at MAX_OTP_ISSUES', async () => {
    const fake = installFake();
    const { branch } = await setupPending(fake);

    for (let i = 1; i < MAX_OTP_ISSUES; i++) {
      await resendBranchApprovalForUser(OTHER, branch.id);
    }
    const err = await rejectionOf(resendBranchApprovalForUser(OTHER, branch.id));

    expect(err.statusCode).toBe(429);
    expect(fake.store.branch_approval_otps).toHaveLength(MAX_OTP_ISSUES);
  });

  it('concurrent resends cannot push a branch past the cap', async () => {
    const fake = installFake();
    const { branch } = await setupPending(fake);

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () => resendBranchApprovalForUser(OTHER, branch.id))
    );

    const succeeded = settled.filter(s => s.status === 'fulfilled').length;
    expect(succeeded).toBe(MAX_OTP_ISSUES - 1);
    expect(fake.store.branch_approval_otps).toHaveLength(MAX_OTP_ISSUES);
  });

  it('a resend recovers a branch locked out by wrong guesses', async () => {
    const fake = installFake();
    const { branch } = await setupPending(fake);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await rejectionOf(approveBranchForUser(OTHER, branch.id, '000000'));
    }

    await resendBranchApprovalForUser(OTHER, branch.id);
    const approved = await approveBranchForUser(
      OTHER,
      branch.id,
      otpSentTo(MAIN_OWNER_PHONE)
    );

    expect(approved.branch_status).toBe('active');
  });

  it('a failed SMS still stores the new code and reports otp_sent false', async () => {
    const fake = installFake();
    const { branch } = await setupPending(fake);
    notificationService.sendDirectSMS.mockResolvedValueOnce(false);

    const { otp_sent } = await resendBranchApprovalForUser(OTHER, branch.id);

    expect(otp_sent).toBe(false);
    expect(fake.store.branch_approval_otps).toHaveLength(2);
  });
});

// ── Lookup rate limit ───────────────────────────────────────────────────────

describe('branch lookup rate limit', () => {
  it('returns 429 after 10 creation attempts from one account', () => {
    const req = { user: { id: 4242 }, ip: '10.0.0.1' };
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = {
        status: jest.fn(function status(code) {
          statuses.push(code);
          return this;
        }),
        set: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn(() => statuses.push('next'));
      branchLookupLimiter(req, res, next);
    }
    expect(statuses.slice(0, 10).every(s => s === 'next')).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
