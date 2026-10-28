jest.mock('#config/database.js', () => ({
  db: { select: jest.fn() },
}));

import { db } from '#config/database.js';
import { creditAccounts } from '#models/credit.model.js';
import { validateCreditPaymentAccount } from '../src/middleware/creditPayment.middleware.js';

function setupAccountLookup(account, business) {
  db.select.mockImplementation(() => ({
    from: table => ({
      where: () => ({
        limit: async () => (table === creditAccounts ? account : business),
      }),
    }),
  }));
}

function makeRequest() {
  return { body: { accountId: 1 }, user: { id: 10 } };
}

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('validateCreditPaymentAccount', () => {
  it('sets the owned business id for revenueGuard', async () => {
    setupAccountLookup(
      [{ id: 1, business_id: 20 }],
      [{ id: 20, user_id: 10, branch_status: 'active' }]
    );
    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await validateCreditPaymentAccount(req, res, next);

    expect(req.body.businessId).toBe(20);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks another user account before revenueGuard', async () => {
    setupAccountLookup([{ id: 1, business_id: 20 }], []);
    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await validateCreditPaymentAccount(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the account does not exist', async () => {
    setupAccountLookup([], []);
    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await validateCreditPaymentAccount(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('blocks accounts in pending branches before revenueGuard', async () => {
    setupAccountLookup(
      [{ id: 1, business_id: 20 }],
      [{ id: 20, user_id: 10, branch_status: 'pending_approval' }]
    );
    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await validateCreditPaymentAccount(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Branch is awaiting approval' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
