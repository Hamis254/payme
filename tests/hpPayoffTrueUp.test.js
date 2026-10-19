/**
 * finalizeAgreementStockDeduction — the payoff true-up.
 *
 * This runs exactly once per agreement: on the payment that brings the
 * balance to zero, `should_deduct_stock` flips and the goods finally leave
 * the shop via real FIFO deduction. Until that moment every cost/profit
 * split on the agreement was measured against the CATALOG estimate
 * (`estimated_cost`, snapshotted at signing). Real FIFO cost is usually
 * different — stock gets restocked at new prices between signing and
 * payoff — so the difference is booked as a one-line true-up against the
 * most recent payment.
 *
 * The invariant that matters, and the reason this file exists:
 *
 *   Σ profit_realized  ==  total_amount − REAL total cost
 *
 * not the estimate. If the true-up has the wrong sign, the wrong
 * magnitude, or lands on the wrong row, the agreement's lifetime profit
 * silently disagrees with the goods that actually left the shop, and
 * nothing else in the system would notice.
 *
 * The seeded agreement (real agreement 11, real backfilled basis):
 *
 *   total_amount    29457.60
 *   estimated_cost  17620.00      → profit booked over the schedule 11837.60
 *
 *   payment history seeded before the final payoff:
 *     deposit      5000.00  → cost 5000.00,  profit     0.00
 *     installment 23457.60  → cost 12620.00, profit 10837.60
 *   final payoff payment made by the test:
 *                  1000.00  → cost     0.00, profit  1000.00
 *                                    Σ profit before true-up = 11837.60
 */

jest.mock('#config/database.js', () => ({
  db: { transaction: jest.fn() },
  sql: jest.fn(),
}));

jest.mock('#services/stock.service.js', () => ({
  deductStockFIFO: jest.fn(),
  releaseStockReservation: jest.fn(),
}));

import { db } from '#config/database.js';
import { deductStockFIFO, releaseStockReservation } from '#services/stock.service.js';
import { recordInstallmentPayment } from '#services/higherPurchase.service.js';
import {
  hirePurchaseAgreements,
  hirePurchaseInstallments,
  hirePurchaseInstallmentPayments,
} from '#models/higherPurchase.model.js';
import { saleItems } from '#models/sales.model.js';

const TOTAL = 29457.6;
const ESTIMATE = 17620;
const PROFIT_BEFORE_TRUEUP = 11837.6; // TOTAL − ESTIMATE

/**
 * The three goods on the agreement. total_price sums to TOTAL exactly, so
 * the per-item profit backfill can be checked against real numbers.
 */
const ITEMS = [
  { id: 71, product_id: 301, quantity: '2.000', total_price: '10000.00' },
  { id: 72, product_id: 302, quantity: '1.000', total_price: '15000.00' },
  { id: 73, product_id: 303, quantity: '3.000', total_price: '4457.60' },
];

/**
 * Transaction stand-in. Richer than the one in hpInstallmentSplit.test.js
 * because the finalize path needs two things that harness didn't:
 *
 *  - inserts must become visible to later selects in the same tx, since
 *    the true-up re-reads the payment row it just inserted;
 *  - orderBy(desc(payment_date)).limit(1) must actually return the NEWEST
 *    row. Seeded rows are chronological, so desc is modelled by reversing
 *    before limit — otherwise the true-up would silently land on the
 *    oldest payment and the test would be asserting the wrong row.
 */
function makeTx(seed, log) {
  // Read the direction off drizzle's own order expression rather than
  // assuming it. If this just reversed unconditionally, swapping desc()
  // for asc() in the source would still pass, and "applies the true-up to
  // the newest payment" would be asserting nothing.
  // drizzle wraps literals in StringChunk, whose .value is an array:
  // desc() ends with [" desc"], asc() with [" asc"].
  const isDesc = expr =>
    (expr?.queryChunks ?? [])
      .flatMap(c => (typeof c === 'string' ? [c] : (c?.value ?? [])))
      .some(s => typeof s === 'string' && s.trim() === 'desc');

  const chain = rows => {
    const p = Promise.resolve(rows);
    p.limit = () => Promise.resolve(rows.slice(0, 1));
    p.orderBy = expr => chain(isDesc(expr) ? [...rows].reverse() : [...rows]);
    return p;
  };

  return {
    select: () => ({
      from: table => {
        log.push({ op: 'select', table });
        return { where: () => chain(seed.get(table) ?? []) };
      },
    }),
    insert: table => ({
      values: vals => {
        log.push({ op: 'insert', table, vals });
        const row = { id: 900 + (seed.get(table)?.length ?? 0), ...vals };
        seed.set(table, [...(seed.get(table) ?? []), row]); // visible to later selects
        const p = Promise.resolve([row]);
        p.returning = () => Promise.resolve([row]);
        return p;
      },
    }),
    update: table => ({
      set: vals => ({
        where: () => {
          log.push({ op: 'update', table, vals });
          const row = [{ id: 900, ...vals }];
          const p = Promise.resolve(row);
          p.returning = () => Promise.resolve(row);
          return p;
        },
      }),
    }),
  };
}

/** Agreement one payment away from payoff, with its history already booked. */
function seedAtPayoff() {
  return new Map([
    [
      hirePurchaseInstallments,
      [{ id: 55, agreement_id: 11, amount_due: '1000.00', amount_paid: '0', status: 'pending' }],
    ],
    [
      hirePurchaseAgreements,
      [
        {
          id: 11,
          sale_id: 38,
          total_amount: String(TOTAL),
          estimated_cost: String(ESTIMATE),
          balance_remaining: '1000.00', // 28457.60 already received
          installments_paid: 1,
          status: 'active',
        },
      ],
    ],
    [
      hirePurchaseInstallmentPayments,
      [
        { id: 1, agreement_id: 11, payment_type: 'deposit', amount: '5000.00', cost_recovered: '5000.00', profit_realized: '0.00', payment_date: new Date('2026-01-01') },
        { id: 2, agreement_id: 11, payment_type: 'installment', amount: '23457.60', cost_recovered: '12620.00', profit_realized: '10837.60', payment_date: new Date('2026-02-01') },
      ],
    ],
    [saleItems, ITEMS],
  ]);
}

/**
 * Make FIFO report a given real cost, split across the three items in
 * fixed proportion so per-item assertions stay predictable.
 */
function mockFIFO(realTotalCost) {
  const share = { 301: 1 / 3, 302: 0.5, 303: 1 / 6 };
  deductStockFIFO.mockImplementation(async productId => ({
    deductions: [{ total_cost: round2(realTotalCost * share[productId]) }],
  }));
}

/** Pay off the agreement; return the writes the true-up produced. */
async function payOff(seed) {
  const log = [];
  db.transaction.mockImplementation(async cb => cb(makeTx(seed, log)));

  await recordInstallmentPayment({
    agreementId: 11,
    installmentId: 55,
    amountPaid: 1000,
    paymentMethod: 'cash',
    paymentDate: '2026-03-01',
  });

  const paymentInsert = log.find(e => e.op === 'insert' && e.table === hirePurchaseInstallmentPayments);
  const paymentUpdates = log.filter(e => e.op === 'update' && e.table === hirePurchaseInstallmentPayments);
  const itemUpdates = log.filter(e => e.op === 'update' && e.table === saleItems);
  const agreementUpdate = log.find(e => e.op === 'update' && e.table === hirePurchaseAgreements);
  return { log, paymentInsert, paymentUpdates, itemUpdates, agreementUpdate };
}

/** Lifetime profit on the agreement, after any true-up is applied. */
function cumulativeProfit(paymentInsert, paymentUpdates) {
  const booked = 0 + 10837.6 + Number(paymentInsert.vals.profit_realized);
  const adjustment = paymentUpdates.reduce(
    (s, u) => s + (Number(u.vals.profit_realized) - Number(paymentInsert.vals.profit_realized)),
    0
  );
  return round2(booked + adjustment);
}

beforeEach(() => jest.clearAllMocks());

describe('finalizeAgreementStockDeduction — payoff true-up', () => {
  it('fires only on the payoff payment, not on a partial one', async () => {
    // Same agreement, but 5000 still outstanding: stock must NOT move.
    const seed = seedAtPayoff();
    seed.get(hirePurchaseAgreements)[0].balance_remaining = '5000.00';
    mockFIFO(18000);

    const log = [];
    db.transaction.mockImplementation(async cb => cb(makeTx(seed, log)));
    await recordInstallmentPayment({
      agreementId: 11, installmentId: 55, amountPaid: 1000,
      paymentMethod: 'cash', paymentDate: '2026-03-01',
    });

    expect(deductStockFIFO).not.toHaveBeenCalled();
    expect(releaseStockReservation).not.toHaveBeenCalled();
    expect(log.some(e => e.op === 'update' && e.table === saleItems)).toBe(false);
  });

  it('deducts every item once and releases every reservation on payoff', async () => {
    const seed = seedAtPayoff();
    mockFIFO(18000);

    await payOff(seed);

    expect(deductStockFIFO).toHaveBeenCalledTimes(3);
    expect(releaseStockReservation).toHaveBeenCalledTimes(3);
    for (const item of ITEMS) {
      expect(deductStockFIFO).toHaveBeenCalledWith(item.product_id, Number(item.quantity), expect.anything());
    }
  });

  it('books a NEGATIVE true-up when real cost exceeds the estimate', async () => {
    // Stock got dearer since signing: real 18000 vs estimate 17620.
    // Profit was overstated by 380, so the final payment's profit drops
    // 1000 → 620.
    const seed = seedAtPayoff();
    mockFIFO(18000);

    const { paymentInsert, paymentUpdates } = await payOff(seed);

    expect(paymentInsert.vals.profit_realized).toBe('1000');
    expect(paymentUpdates).toHaveLength(1);
    expect(paymentUpdates[0].vals.profit_realized).toBe('620');
  });

  it('books a POSITIVE true-up when real cost is below the estimate', async () => {
    // Cheaper than estimated: real 17000 vs 17620 → profit understated by
    // 620, so the final payment's profit rises 1000 → 1620.
    const seed = seedAtPayoff();
    mockFIFO(17000);

    const { paymentUpdates } = await payOff(seed);

    expect(paymentUpdates).toHaveLength(1);
    expect(paymentUpdates[0].vals.profit_realized).toBe('1620');
  });

  it('writes no true-up at all when estimate and real cost agree', async () => {
    const seed = seedAtPayoff();
    mockFIFO(ESTIMATE);

    const { paymentUpdates } = await payOff(seed);

    // trueUpAmount === 0 → the payment row must be left exactly as booked.
    expect(paymentUpdates).toHaveLength(0);
  });

  it.each([
    ['real cost above estimate', 18000],
    ['real cost below estimate', 17000],
    ['real cost equal to estimate', ESTIMATE],
    ['real cost far above estimate', 25000],
    ['real cost near zero', 0.5],
  ])('lifetime profit foots to total − REAL cost (%s)', async (_label, realCost) => {
    // The invariant the whole true-up exists to preserve. Note it must
    // foot to the REAL cost, never the estimate.
    const seed = seedAtPayoff();
    mockFIFO(realCost);

    const { paymentInsert, paymentUpdates } = await payOff(seed);

    expect(cumulativeProfit(paymentInsert, paymentUpdates)).toBe(round2(TOTAL - realCost));
    // and it must NOT foot to the estimate unless they happen to be equal
    if (realCost !== ESTIMATE) {
      expect(cumulativeProfit(paymentInsert, paymentUpdates)).not.toBe(PROFIT_BEFORE_TRUEUP);
    }
  });

  it('backfills each sale item with its REAL FIFO cost and profit', async () => {
    // Until payoff these rows carry unit_cost 0 / profit 0, because the
    // goods had not left the shop. This is where they become true.
    const seed = seedAtPayoff();
    mockFIFO(18000); // → 6000 / 9000 / 3000 across the three items

    const { itemUpdates } = await payOff(seed);

    expect(itemUpdates).toHaveLength(3);
    // item 71: cost 6000 over qty 2 → unit 3000, profit 10000 − 6000
    expect(itemUpdates[0].vals).toMatchObject({ unit_cost: '3000', profit: '4000' });
    // item 72: cost 9000 over qty 1 → unit 9000, profit 15000 − 9000
    expect(itemUpdates[1].vals).toMatchObject({ unit_cost: '9000', profit: '6000' });
    // item 73: cost 3000 over qty 3 → unit 1000, profit 4457.60 − 3000
    expect(itemUpdates[2].vals).toMatchObject({ unit_cost: '1000', profit: '1457.6' });
  });

  it('marks the agreement completed on the payoff payment', async () => {
    const seed = seedAtPayoff();
    mockFIFO(18000);

    const { agreementUpdate } = await payOff(seed);

    expect(agreementUpdate.vals.status).toBe('completed');
    expect(agreementUpdate.vals.balance_remaining).toBe('0');
  });

  it('applies the true-up to the NEWEST payment, not an older one', async () => {
    // The adjustment has to land on the payment just booked. Landing it on
    // the deposit would keep the agreement total correct while making the
    // individual payment rows wrong — invisible to a totals-only check.
    const seed = seedAtPayoff();
    mockFIFO(18000);

    const { paymentUpdates, paymentInsert } = await payOff(seed);

    expect(paymentUpdates).toHaveLength(1);
    // The newest row is the 1000 payoff payment (profit 1000 → 620), NOT
    // the seeded deposit (0.00) or the seeded installment (10837.60).
    expect(paymentInsert.vals.profit_realized).toBe('1000');
    expect(paymentUpdates[0].vals.profit_realized).toBe('620');
    expect(paymentUpdates[0].vals.profit_realized).not.toBe('10457.6'); // 10837.60 − 380
    expect(paymentUpdates[0].vals.profit_realized).not.toBe('-380');    // 0 − 380
  });
});

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
