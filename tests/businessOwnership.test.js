jest.mock('#config/database.js', () => ({
  db: {
    transaction: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('#config/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('#middleware/auth.middleware.js', () => ({
  authenticateToken: (req, res, next) => {
    const userId = Number(req.headers['x-test-user']);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: userId };
    next();
  },
}));

jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  eq: (col, val) => ({ kind: 'eq', col, val }),
  and: (...conds) => ({ kind: 'and', conds }),
}));

jest.mock('#controllers/record.controller.js', () => ({
  createRecord: (_req, res) => res.status(200).json({ success: true }),
  getRecords: (_req, res) => res.status(200).json({ success: true }),
  getRecordById: (_req, res) => res.status(200).json({ success: true }),
  getTotals: (_req, res) => res.status(200).json({ success: true }),
  getDashboardInsights: (_req, res) => res.status(200).json({ success: true }),
  getStatementFinancialsPreview: (_req, res) =>
    res.status(200).json({ success: true }),
  generateStatement: (_req, res) => res.status(200).json({ success: true }),
}));

jest.mock('#controllers/higherPurchase.controller.js', () => {
  const handler = (_req, res) => res.status(200).json({ success: true });
  return {
    createAgreementHandler: handler,
    getAgreementHandler: handler,
    listAgreementsHandler: handler,
    recordPaymentHandler: handler,
    getOverdueHandler: handler,
    getUpcomingHandler: handler,
    getSummaryHandler: handler,
    getPaymentHistoryHandler: handler,
    updateStatusHandler: handler,
  };
});

import express from 'express';
import { db } from '#config/database.js';
import { installFake as installFakeDb } from './helpers/fakeDb.js';
import businessesRoutes from '#routes/businesses.routes.js';
import recordRoutes from '#routes/record.routes.js';
import higherPurchaseRoutes from '#routes/higherPurchase.routes.js';

const BUSINESS_ID = '41';
const OWNER_ID = 1;
const OTHER_USER_ID = 2;

const app = express();
app.use(express.json());
app.use('/api/businesses', businessesRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/hire-purchase', higherPurchaseRoutes);

let server;
let baseUrl;

const getAsUser = async (userId, path) =>
  globalThis.fetch(`${baseUrl}${path}`, {
    headers: { 'x-test-user': String(userId) },
  });

beforeAll(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
});

beforeEach(() => {
  const fake = installFakeDb(db);
  const createdAt = new Date('2026-10-01T09:00:00+03:00');
  fake.store.users.push(
    { id: OWNER_ID, name: 'Main owner' },
    { id: OTHER_USER_ID, name: 'Branch owner' }
  );
  fake.store.businesses.push({
    id: BUSINESS_ID,
    user_id: OWNER_ID,
    branch_status: 'active',
  });
  fake.store.businesses.push(
    {
      id: 50,
      user_id: OWNER_ID,
      is_main: true,
      parent_business_id: null,
    },
    {
      id: 51,
      user_id: OTHER_USER_ID,
      business_code: 'PRO4821-1',
      name: 'Attached branch',
      location: 'Westlands',
      branch_status: 'pending_approval',
      created_at: createdAt,
      is_main: false,
      parent_business_id: 50,
    }
  );
});

describe('business ownership on record and hire-purchase routes', () => {
  it.each([
    ['/api/records/:business_id', `/api/records/${BUSINESS_ID}`],
    ['/api/records/:business_id/totals', `/api/records/${BUSINESS_ID}/totals`],
    ['/api/hire-purchase/:businessId', `/api/hire-purchase/${BUSINESS_ID}`],
  ])('%s denies another user but allows the business owner', async (_route, path) => {
    const otherUserResponse = await getAsUser(OTHER_USER_ID, path);
    expect(otherUserResponse.status).toBe(403);

    const ownerResponse = await getAsUser(OWNER_ID, path);
    expect(ownerResponse.status).toBe(200);
  });
});

describe('branches for a main business', () => {
  it('returns branch details to the main owner and 404s for other callers', async () => {
    const ownerResponse = await getAsUser(
      OWNER_ID,
      '/api/businesses/50/branches'
    );
    expect(ownerResponse.status).toBe(200);
    await expect(ownerResponse.json()).resolves.toMatchObject({
      count: 1,
      branches: [
        {
          id: 51,
          business_code: 'PRO4821-1',
          name: 'Attached branch',
          location: 'Westlands',
          branch_status: 'pending_approval',
          created_at: '2026-10-01T06:00:00.000Z',
          owner_name: 'Branch owner',
        },
      ],
    });

    const otherOwnerResponse = await getAsUser(
      OTHER_USER_ID,
      '/api/businesses/50/branches'
    );
    expect(otherOwnerResponse.status).toBe(404);

    const branchOwnerResponse = await getAsUser(
      OTHER_USER_ID,
      '/api/businesses/51/branches'
    );
    expect(branchOwnerResponse.status).toBe(404);
  });
});
