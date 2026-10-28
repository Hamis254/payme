/**
 * recordCreditPayment — cost-recovery-first split.
 *
 * Every expected number below is hand-computed in the comment above the
 * assertion, from the seeded rows, using the rule "cost comes out first".
 * If someone changes the math, these fail with a wrong number rather than
 * quietly agreeing with whatever the code now produces.
 *
 * The seeded receivable, used by every test in the first block:
 *
 *   sale 501: total_amount 1000, items 2 × unit_cost 300  → cost 600
 *   sale 502: total_amount  500, items 1 × unit_cost 100  → cost 100
 *   ────────────────────────────────────────────────────────────────
 *   totalSaleValue 1500, totalCost 700, gross profit 800
 *
 * `amountReceivedBeforeThisPayment` is derived as value − outstanding, so
 * each test sets the outstanding_amount columns to place the account at a
 * chosen point on the recovery curve.
 */

jest.mock('#config/database.js', () => ({
  db: { transaction: jest.fn(), select: jest.fn() },
}));

jest.mock('#services/record.service.js', () => ({ createRecord: jest.fn() }));
jest.mock('#utils/notificationEmitter.js', () => ({
  emitNotification: jest.fn(),
  notifications: {
    creditSaleCreated: jest.fn(args => ({
      type: 'credit_sale_created',
      metadata: args,
    })),
    creditPaymentReceived: jest.fn(args => ({
      type: 'credit_payment_received',
      metadata: args,
    })),
  },
}));
jest.mock('#services/credit.service.js', () => ({
  getCreditSalesForBusiness: jest.fn(),
  getCreditAccountsForBusiness: jest.fn(),
  getCreditAccountById: jest.fn(),
}));

import { db } from '#config/database.js';
import {
  createCreditSale,
  recordCreditPayment,
} from '../src/controllers/credit.controller.js';
import { createRecord } from '#services/record.service.js';
import { emitNotification, notifications } from '#utils/notificationEmitter.js';
import {
  creditAccounts,
  creditSales,
  creditPayments,
} from '#models/credit.model.js';
import { sales, saleItems } from '#models/sales.model.js';
import { businesses } from '#models/setting.model.js';

/**
 * Minimal stand-in for a drizzle transaction. Rows are seeded per table
 * and returned regardless of the where() predicate, so these tests pin
 * the arithmetic and the call ordering — not the SQL predicates.
 */
let txCommittedAtNotify = false;
let notificationCommitStates = [];

function makeTx(seed, log) {
  const rowsFor = table => seed.get(table) ?? [];

  const thenable = rows => {
    const p = Promise.resolve(rows);
    p.limit = () => Promise.resolve(rows.slice(0, 1));
    return p;
  };

  return {
    select: () => ({
      from: table => {
        log.push({ op: 'select', table });
        return { where: () => thenable(rowsFor(table)) };
      },
    }),
    insert: table => ({
      values: vals => {
        log.push({ op: 'insert', table, vals });
        const row = [{ id: 4242, ...vals }];
        const p = Promise.resolve(row);
        p.returning = () => Promise.resolve(row);
        return p;
      },
    }),
    update: table => ({
      set: vals => ({
        where: () => {
          log.push({ op: 'update', table, vals });
          return Promise.resolve();
        },
      }),
    }),
  };
}

/** Seed the two-sale receivable, with outstanding amounts supplied per test. */
function seedReceivable({ balanceDue, outstanding501, outstanding502 }) {
  return new Map([
    [
      creditAccounts,
      [
        {
          id: 1,
          business_id: 20,
          customer_name: 'Customer One',
          balance_due: String(balanceDue),
        },
      ],
    ],
    [
      creditSales,
      [
        {
          id: 11,
          sale_id: 501,
          outstanding_amount: String(outstanding501),
          account_id: 1,
        },
        {
          id: 12,
          sale_id: 502,
          outstanding_amount: String(outstanding502),
          account_id: 1,
        },
      ],
    ],
    [
      sales,
      [
        { id: 501, total_amount: '1000.00' },
        { id: 502, total_amount: '500.00' },
      ],
    ],
    [
      saleItems,
      [
        { sale_id: 501, unit_cost: '300.00', quantity: 2 },
        { sale_id: 502, unit_cost: '100.00', quantity: 1 },
      ],
    ],
  ]);
}

/** Drive recordCreditPayment against a seeded tx; return the captured writes. */
async function runPayment(seed, body) {
  const log = [];
  let transactionCommitted = false;
  let committedWrites = [];
  txCommittedAtNotify = false;
  db.transaction.mockImplementation(async cb => {
    const result = await cb(makeTx(seed, log));
    transactionCommitted = true;
    txCommittedAtNotify = true;
    committedWrites = log.slice();
    return result;
  });

  const req = {
    body,
    user: { id: 10 },
    revenueGuard: { balance_before: 5 },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await recordCreditPayment(req, res, next);

  const paymentInsert = log.find(
    e => e.op === 'insert' && e.table === creditPayments
  );
  return {
    log,
    res,
    next,
    paymentInsert,
    transactionCommitted,
    committedWrites,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  txCommittedAtNotify = false;
  notificationCommitStates = [];
  emitNotification.mockImplementation(() => {
    notificationCommitStates.push(txCommittedAtNotify);
    return Promise.resolve();
  });
  db.select.mockImplementation(() => ({
    from: table => ({
      where: () => ({
        limit: async () => (table === businesses ? [{ id: 20 }] : []),
      }),
    }),
  }));
});

describe('recordCreditPayment — cost-recovery-first split', () => {
  it('emits one credit-sale notification after its transaction commits', async () => {
    const seed = new Map([
      [sales, [{ id: 501, business_id: 20, customer_type: 'credit' }]],
      [
        creditAccounts,
        [
          {
            id: 1,
            business_id: 20,
            customer_name: 'Customer One',
            balance_due: '100',
            credit_limit: '1000',
            is_active: true,
          },
        ],
      ],
    ]);
    const log = [];
    txCommittedAtNotify = false;
    db.transaction.mockImplementation(async cb => {
      const result = await cb(makeTx(seed, log));
      txCommittedAtNotify = true;
      return result;
    });
    const req = {
      body: {
        businessId: 20,
        saleId: 501,
        accountId: 1,
        dueDate: '2026-11-01',
        outstandingAmount: 200,
      },
      user: { id: 10 },
      revenueGuard: { balance_before: 5 },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createCreditSale(req, res, next);

    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(notifications.creditSaleCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        credit_sale_id: 4242,
        amount: 200,
        customer_name: 'Customer One',
        balance_remaining: 300,
        business_id: 20,
      })
    );
    expect(notificationCommitStates).toEqual([true]);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not emit a credit-sale notification when the transaction fails', async () => {
    db.transaction.mockRejectedValueOnce(new Error('transaction rolled back'));
    const req = {
      body: {
        businessId: 20,
        saleId: 501,
        accountId: 1,
        dueDate: '2026-11-01',
        outstandingAmount: 200,
      },
      user: { id: 10 },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createCreditSale(req, res, next);

    expect(emitNotification).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'transaction rolled back' })
    );
  });

  it('charges one token and writes a paid credit_payment record atomically', async () => {
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });

    const { log, res, paymentInsert } = await runPayment(seed, {
      accountId: 1,
      amount: 400,
      paymentMethod: 'cash',
    });

    expect(paymentInsert).toBeDefined();
    expect(createRecord).toHaveBeenCalledTimes(1);
    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 20,
        user_id: 10,
        type: 'credit',
        category: 'credit_payment',
        amount: 400,
        payment_method: 'cash',
        reference_id: 'credit-payment-4242',
        description: 'Payment received from Customer One',
        credit_status: 'paid',
      }),
      expect.any(Object)
    );
    expect(log.filter(entry => entry.op === 'insert' && entry.table === creditPayments))
      .toHaveLength(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ tokens_remaining: 4 })
    );
    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(notifications.creditPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 400,
        customer_name: 'Customer One',
        balance_remaining: 1100,
        business_id: 20,
      })
    );
    expect(notificationCommitStates).toEqual([true]);
  });

  it('returns 402 and rolls back the payment when the atomic token spend fails', async () => {
    createRecord.mockRejectedValueOnce(
      new Error('Insufficient tokens. Please purchase tokens to create records.')
    );
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });

    const { res, next, transactionCommitted, committedWrites } =
      await runPayment(seed, {
        accountId: 1,
        amount: 400,
        paymentMethod: 'cash',
      });

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PAYMENT_REQUIRED' })
    );
    expect(transactionCommitted).toBe(false);
    expect(
      committedWrites.some(
        entry => entry.op === 'insert' && entry.table === creditPayments
      )
    ).toBe(false);
    expect(emitNotification).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('books an early payment as pure cost recovery, zero profit', async () => {
    // Nothing received yet: outstanding 1000 + 500 = 1500 = full value.
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });

    const { paymentInsert, res, next } = await runPayment(seed, {
      accountId: 1,
      amount: 400,
      paymentMethod: 'cash',
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);

    // receivedBefore 0 → receivedAfter 400. cost 700 not yet recovered,
    // so all 400 is cost: min(400,700) − min(0,700) = 400. Profit 0.
    expect(paymentInsert.vals.cost_recovered).toBe('400');
    expect(paymentInsert.vals.profit_realized).toBe('0');
  });

  it('splits the payment that straddles the cost line', async () => {
    // 400 already received → outstanding 600 + 500 = 1100.
    const seed = seedReceivable({
      balanceDue: 1100,
      outstanding501: 600,
      outstanding502: 500,
    });

    const { paymentInsert, next } = await runPayment(seed, {
      accountId: 1,
      amount: 500,
      paymentMethod: 'cash',
    });

    expect(next).not.toHaveBeenCalled();

    // receivedBefore 400 → receivedAfter 900. Cost recovered goes
    // min(400,700)=400 → min(900,700)=700, so 300 of this payment is
    // cost and the remaining 500 − 300 = 200 is the first real profit.
    expect(paymentInsert.vals.cost_recovered).toBe('300');
    expect(paymentInsert.vals.profit_realized).toBe('200');
  });

  it('books a late payment as pure profit once cost is recovered', async () => {
    // 900 already received → outstanding 100 + 500 = 600.
    const seed = seedReceivable({
      balanceDue: 600,
      outstanding501: 100,
      outstanding502: 500,
    });

    const { paymentInsert, next } = await runPayment(seed, {
      accountId: 1,
      amount: 600,
      paymentMethod: 'cash',
    });

    expect(next).not.toHaveBeenCalled();

    // receivedBefore 900 → cost already fully recovered (min(900,700)=700),
    // so min(1500,700) − min(900,700) = 0 cost and all 600 is profit.
    expect(paymentInsert.vals.cost_recovered).toBe('0');
    expect(paymentInsert.vals.profit_realized).toBe('600');
  });

  it('recovers exactly totalCost and totalProfit across the full schedule', async () => {
    // The three payments above are the whole 1500. Summing them is the
    // property that actually matters: no cost double-counted, no profit
    // invented. 400 + 300 + 0 = 700 = totalCost.
    //           0 + 200 + 600 = 800 = 1500 − 700.
    const schedule = [
      { balanceDue: 1500, outstanding501: 1000, outstanding502: 500, pay: 400 },
      { balanceDue: 1100, outstanding501: 600, outstanding502: 500, pay: 500 },
      { balanceDue: 600, outstanding501: 100, outstanding502: 500, pay: 600 },
    ];

    let cost = 0;
    let profit = 0;
    for (const step of schedule) {
      const { paymentInsert } = await runPayment(seedReceivable(step), {
        accountId: 1,
        amount: step.pay,
        paymentMethod: 'cash',
      });
      cost += Number(paymentInsert.vals.cost_recovered);
      profit += Number(paymentInsert.vals.profit_realized);
    }

    expect(cost).toBe(700);
    expect(profit).toBe(800);
    expect(cost + profit).toBe(1500);
  });

  it('reads the receivable before mutating any row', async () => {
    // The split depends on the pre-payment outstanding, so every read the
    // basis needs must happen before the first insert/update.
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });

    const { log } = await runPayment(seed, {
      accountId: 1,
      amount: 400,
      paymentMethod: 'cash',
    });

    const lastBasisRead = Math.max(
      log.findIndex(e => e.op === 'select' && e.table === creditSales),
      log.findIndex(e => e.op === 'select' && e.table === sales),
      log.findIndex(e => e.op === 'select' && e.table === saleItems)
    );
    const firstWrite = log.findIndex(e => e.op !== 'select');

    expect(lastBasisRead).toBeGreaterThanOrEqual(0);
    expect(lastBasisRead).toBeLessThan(firstWrite);
  });
});

describe('recordCreditPayment — refuses an unverifiable split', () => {
  const paymentWasWritten = log =>
    log.some(e => e.op === 'insert' && e.table === creditPayments);

  it('fails loudly when the account has no credit_sales rows', async () => {
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });
    seed.set(creditSales, []);

    const { log, next } = await runPayment(seed, {
      accountId: 1,
      amount: 400,
      paymentMethod: 'cash',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      name: 'DatabaseError',
      statusCode: 500,
    });
    expect(next.mock.calls[0][0].message).toMatch(/no credit_sales rows/);
    // The whole point: nothing was written with a guessed split.
    expect(paymentWasWritten(log)).toBe(false);
  });

  it('fails loudly when a credit_sales row has a null sale_id', async () => {
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });
    // Row 12 loses its sale_id. Its 500 of outstanding value can no longer
    // be traced to a sale, so no cost can be attached to it — dropping it
    // silently would cost that 500 at zero and book it as pure profit.
    seed.set(creditSales, [
      { id: 11, sale_id: 501, outstanding_amount: '1000', account_id: 1 },
      { id: 12, sale_id: null, outstanding_amount: '500', account_id: 1 },
    ]);

    const { log, next } = await runPayment(seed, {
      accountId: 1,
      amount: 400,
      paymentMethod: 'cash',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      name: 'DatabaseError',
      statusCode: 500,
    });
    expect(next.mock.calls[0][0].message).toMatch(/1 of 2 credit_sales rows/);
    expect(next.mock.calls[0][0].message).toMatch(/have no sale_id/);
    expect(paymentWasWritten(log)).toBe(false);
  });

  it('fails loudly when a sale has no line items to cost against', async () => {
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });
    // Drop sale 502's items — its 500 of value now has no cost behind it,
    // which under the old fallback would have been booked as pure profit.
    seed.set(saleItems, [{ sale_id: 501, unit_cost: '300.00', quantity: 2 }]);

    const { log, next } = await runPayment(seed, {
      accountId: 1,
      amount: 400,
      paymentMethod: 'cash',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].message).toMatch(/no sale_items/);
    expect(next.mock.calls[0][0].message).toMatch(/502/);
    expect(paymentWasWritten(log)).toBe(false);
  });

  it('fails loudly when a referenced sale row is missing', async () => {
    const seed = seedReceivable({
      balanceDue: 1500,
      outstanding501: 1000,
      outstanding502: 500,
    });
    seed.set(sales, [{ id: 501, total_amount: '1000.00' }]);

    const { log, next } = await runPayment(seed, {
      accountId: 1,
      amount: 400,
      paymentMethod: 'cash',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].message).toMatch(/expected 2 sales rows/);
    expect(paymentWasWritten(log)).toBe(false);
  });
});
