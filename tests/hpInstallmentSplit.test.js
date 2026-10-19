/**
 * recordInstallmentPayment — the INSTALLMENT path, not the deposit path.
 *
 * This exists because the two paths get their cost basis from different
 * places, and only one of them was ever exercised. The deposit path uses
 * the in-memory `estimatedCost` computed during createAgreement; the
 * installment path re-reads it from `agreement.estimated_cost`. That
 * column didn't exist in the model or the database, so the installment
 * path read `undefined` → NaN, and wrote the string "NaN" into two
 * numeric(12,2) columns. Postgres accepts NaN, and one NaN row turns
 * every SUM() over profit_realized into NaN permanently.
 *
 * Nothing caught it because every payment in the data was a deposit.
 *
 * The seeded agreement, used by every test below:
 *
 *   total_amount    29457.60   (real agreement 11)
 *   estimated_cost  17620.00   (real backfilled basis)
 *   ────────────────────────────────────────────────
 *   gross profit    11837.60
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
import { recordInstallmentPayment } from '#services/higherPurchase.service.js';
import {
  hirePurchaseAgreements,
  hirePurchaseInstallments,
  hirePurchaseInstallmentPayments,
} from '#models/higherPurchase.model.js';

const TOTAL = 29457.6;
const COST = 17620;

/**
 * Minimal drizzle-transaction stand-in. Rows are returned per table
 * regardless of the where() predicate, so these tests pin the split
 * arithmetic and what gets written — not the SQL predicates.
 */
function makeTx(seed, log) {
  const rowsFor = table => seed.get(table) ?? [];

  const selectable = table => {
    const p = Promise.resolve(rowsFor(table));
    p.limit = () => Promise.resolve(rowsFor(table).slice(0, 1));
    return p;
  };

  return {
    select: () => ({
      from: table => {
        log.push({ op: 'select', table });
        return {
          where: () => selectable(table),
        };
      },
    }),
    insert: table => ({
      values: vals => {
        log.push({ op: 'insert', table, vals });
        return Promise.resolve([{ id: 900, ...vals }]);
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

/** Seed one active agreement with one pending installment. */
function seedAgreement({ balanceRemaining, estimatedCost = String(COST) }) {
  return new Map([
    [
      hirePurchaseInstallments,
      [
        {
          id: 55,
          agreement_id: 11,
          installment_number: 1,
          amount_due: '2000.00',
          amount_paid: '0',
          status: 'pending',
        },
      ],
    ],
    [
      hirePurchaseAgreements,
      [
        {
          id: 11,
          sale_id: 38,
          total_amount: String(TOTAL),
          estimated_cost: estimatedCost,
          balance_remaining: String(balanceRemaining),
          installments_paid: 0,
          status: 'active',
        },
      ],
    ],
  ]);
}

/** Drive recordInstallmentPayment; return the captured writes. */
async function runInstallment(seed, amountPaid) {
  const log = [];
  db.transaction.mockImplementation(async cb => cb(makeTx(seed, log)));

  const result = await recordInstallmentPayment({
    agreementId: 11,
    installmentId: 55,
    amountPaid,
    paymentMethod: 'cash',
    paymentDate: '2026-08-02',
  });

  const paymentInsert = log.find(
    e => e.op === 'insert' && e.table === hirePurchaseInstallmentPayments
  );
  return { log, result, paymentInsert };
}

beforeEach(() => jest.clearAllMocks());

describe('recordInstallmentPayment — installment split writes real numbers', () => {
  it('never writes NaN into the money columns', async () => {
    // The regression. Before estimated_cost existed as a column this
    // wrote the literal string "NaN" into cost_recovered/profit_realized.
    const seed = seedAgreement({ balanceRemaining: 24457.6 }); // 5000 deposit received

    const { paymentInsert } = await runInstallment(seed, 2000);

    expect(paymentInsert).toBeDefined();
    for (const field of ['cost_recovered', 'profit_realized', 'amount']) {
      const written = paymentInsert.vals[field];
      expect(written).not.toBe('NaN');
      expect(Number.isFinite(Number(written))).toBe(true);
    }
  });

  it('books an early installment as pure cost recovery', async () => {
    // 5000 received (the deposit) → receivedAfter 7000, still under the
    // 17620 cost, so min(7000,17620) − min(5000,17620) = 2000 is all cost.
    const seed = seedAgreement({ balanceRemaining: 24457.6 });

    const { paymentInsert } = await runInstallment(seed, 2000);

    expect(paymentInsert.vals.cost_recovered).toBe('2000');
    expect(paymentInsert.vals.profit_realized).toBe('0');
    expect(paymentInsert.vals.payment_type).toBe('installment');
  });

  it('splits the installment that straddles the cost line', async () => {
    // 17000 received → receivedAfter 18000. Cost recovered goes
    // min(17000,17620)=17000 → min(18000,17620)=17620, so 620 of this
    // payment is cost and the remaining 1000 − 620 = 380 is real profit.
    const seed = seedAgreement({ balanceRemaining: round2(TOTAL - 17000) });

    const { paymentInsert } = await runInstallment(seed, 1000);

    expect(paymentInsert.vals.cost_recovered).toBe('620');
    expect(paymentInsert.vals.profit_realized).toBe('380');
  });

  it('books a late installment as pure profit once cost is recovered', async () => {
    // 20000 received, already past the 17620 cost, so nothing left to
    // recover and the whole 1000 is profit.
    const seed = seedAgreement({ balanceRemaining: round2(TOTAL - 20000) });

    const { paymentInsert } = await runInstallment(seed, 1000);

    expect(paymentInsert.vals.cost_recovered).toBe('0');
    expect(paymentInsert.vals.profit_realized).toBe('1000');
  });

  it('refuses to split when the agreement has no cost basis', async () => {
    // An agreement predating the estimated_cost column that was never
    // backfilled. Booking this would price the payment as pure profit.
    const seed = seedAgreement({
      balanceRemaining: 24457.6,
      estimatedCost: null,
    });

    await expect(runInstallment(seed, 2000)).rejects.toThrow(
      /no estimated_cost/
    );
  });

  it('writes nothing when the cost basis is missing', async () => {
    const seed = seedAgreement({
      balanceRemaining: 24457.6,
      estimatedCost: null,
    });
    const log = [];
    db.transaction.mockImplementation(async cb => cb(makeTx(seed, log)));

    await expect(
      recordInstallmentPayment({
        agreementId: 11,
        installmentId: 55,
        amountPaid: 2000,
        paymentMethod: 'cash',
      })
    ).rejects.toThrow();

    expect(log.some(e => e.op === 'insert')).toBe(false);
    expect(log.some(e => e.op === 'update')).toBe(false);
  });
});

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
