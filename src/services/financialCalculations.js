/**
 * =============================================================================
 * financialCalculations.js
 * =============================================================================
 * Single source of truth for every money calculation in the app.
 *
 * Rules this file encodes:
 *  - Nothing is "profit" until the item's own cost is recovered in real
 *    money. Cost comes out first, every time, from every payment —
 *    credit repayments, HP deposits, HP installments alike.
 *  - Credit and HP sales open as a NEGATIVE ledger entry (a debt), not
 *    revenue. They only turn into positive cash as real payments land.
 *  - HP goods do not leave the shop's stock until the agreement is
 *    fully paid off. Deposits/installments are cash-in-hand the day
 *    they're received, but they are stock-neutral until the balance
 *    hits zero — see should_deduct_stock below.
 *  - Petty/daily expenses (category 'other': lunch, airtime, small
 *    till spend) come out of TODAY's cash-in-hand. Every other
 *    expense category (rent, salaries, utilities, etc.) is excluded
 *    from the daily till figure and only counted in the monthly
 *    report, because that's not how those get paid.
 *
 * This file contains ONLY pure functions — no DB access, no imports
 * from services/models. Every caller fetches its own rows, then hands
 * plain numbers/objects to these functions. That's what keeps this
 * testable and keeps the math from drifting apart again across files.
 * =============================================================================
 */

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Money guard. A missing column, a typo'd field name, or an unapplied
 * migration all arrive here the same way: as undefined → NaN. Postgres
 * `numeric` ACCEPTS 'NaN', and one NaN row poisons every SUM() that ever
 * touches it — silently, and permanently. So a non-finite value must never
 * be allowed to reach an insert; blow up at the source instead, where the
 * message can still name what was missing.
 */
function requireFiniteMoney(label, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(
      `Refusing to compute a money split: ${label} is ${
        value === undefined ? 'undefined' : JSON.stringify(value)
      }, which is not a finite number. Writing this would store NaN and ` +
        'corrupt every total derived from it.'
    );
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────
// FUNCTION 1 — stock-based item profit
// Used directly (as realized profit) for cash & mpesa sales.
// Used as the CATALOG cost/profit basis for credit & HP — before real
// money has been collected, this is the "projected" figure only.
// ─────────────────────────────────────────────────────────────────────────
export function calculateItemProfit({ sellingPricePerUnit, buyingPricePerUnit, quantity }) {
  const sp = Number(sellingPricePerUnit);
  const bp = Number(buyingPricePerUnit);
  const qty = Number(quantity);

  const revenue = round2(sp * qty);
  const cost = round2(bp * qty);
  const profit = round2(revenue - cost);

  return { revenue, cost, profit };
}

// ─────────────────────────────────────────────────────────────────────────
// SHARED ENGINE — cost-recovery-first progress toward a debt
// Used by both credit and HP, since the underlying math is identical:
// money owed, paid off over time, cost recovered before profit counts.
// ─────────────────────────────────────────────────────────────────────────
function calculateReceivableProgress({
  totalCost,
  totalSaleValue,
  amountReceivedBeforeThisPayment = 0,
  paymentAmount = 0,
}) {
  const cost = requireFiniteMoney('totalCost', totalCost);
  const saleValue = requireFiniteMoney('totalSaleValue', totalSaleValue);
  const receivedBefore = requireFiniteMoney(
    'amountReceivedBeforeThisPayment',
    amountReceivedBeforeThisPayment
  );
  const payment = requireFiniteMoney('paymentAmount', paymentAmount);

  const receivedAfter = round2(receivedBefore + payment);
  const outstandingAfter = round2(Math.max(saleValue - receivedAfter, 0));

  const costRecoveredBefore = Math.min(receivedBefore, cost);
  const costRecoveredAfter = Math.min(receivedAfter, cost);

  return {
    payment_recorded: round2(payment),
    cost_recovered_this_payment: round2(costRecoveredAfter - costRecoveredBefore),
    profit_realized_this_payment: round2(payment - (costRecoveredAfter - costRecoveredBefore)),
    cumulative_received: receivedAfter,
    cumulative_cost_recovered: round2(costRecoveredAfter),
    cumulative_profit_realized: round2(Math.max(receivedAfter - cost, 0)),
    outstanding_balance: outstandingAfter,
    fully_paid: outstandingAfter <= 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FUNCTION 2 — credit sales
// ─────────────────────────────────────────────────────────────────────────

/** Opening ledger line when a credit sale is made — a debt, not income. */
export function calculateCreditSaleOpening({ totalSaleValue }) {
  return {
    ledger_entry: round2(-Number(totalSaleValue)),
    ledger_tag: 'CREDIT_PENDING',
  };
}

/** Called each time a credit repayment is recorded. */
export function calculateCreditRepayment({
  totalCost,
  totalSaleValue,
  amountReceivedBeforeThisPayment = 0,
  paymentAmount,
}) {
  const progress = calculateReceivableProgress({
    totalCost,
    totalSaleValue,
    amountReceivedBeforeThisPayment,
    paymentAmount,
  });
  return { ...progress, ledger_tag: 'CREDIT_REPAYMENT' };
}

// ─────────────────────────────────────────────────────────────────────────
// FUNCTION 3 — hire purchase
// ─────────────────────────────────────────────────────────────────────────

/**
 * Opening ledger line when an HP agreement is signed — full value shown
 * negative, same as credit. Stock is untouched at this point.
 */
export function calculateHPAgreementOpening({ totalSaleValue }) {
  return {
    ledger_entry: round2(-Number(totalSaleValue)),
    ledger_tag: 'HP_PENDING',
  };
}

/**
 * Called each time a deposit or installment is recorded against an HP
 * agreement. `should_deduct_stock` only turns true on the payment that
 * brings the balance to exactly zero — that's the signal for
 * higherPurchase.service.js to run FIFO stock deduction for the first
 * time on this agreement's items.
 */
export function calculateHPPayment({
  totalCost,
  totalSaleValue,
  amountReceivedBeforeThisPayment = 0,
  paymentAmount,
  paymentType, // 'deposit' | 'installment'
}) {
  const progress = calculateReceivableProgress({
    totalCost,
    totalSaleValue,
    amountReceivedBeforeThisPayment,
    paymentAmount,
  });

  return {
    ...progress,
    ledger_tag: paymentType === 'deposit' ? 'HP_DEPOSIT' : 'HP_INSTALLMENT',
    should_deduct_stock: progress.fully_paid,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FUNCTION 4 — expenses
// 'other' category = petty/daily cash spend → hits today's till directly.
// Every other category → monthly report only, true business profit.
// ─────────────────────────────────────────────────────────────────────────
const PETTY_DAILY_CATEGORY = 'other';

export function calculateExpenseImpact({ category, amount }) {
  const isPettyDaily = category === PETTY_DAILY_CATEGORY;
  const value = round2(amount);

  return {
    amount: value,
    category,
    hits_daily_cash: isPettyDaily,
    hits_monthly_report: true,
    ledger_tag: isPettyDaily ? 'PETTY_EXPENSE' : 'OPERATING_EXPENSE',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// NO DAY/PERIOD COMPOSER LIVES HERE.
// Rolling a set of rows up into a day's or a period's totals is
// getStatementFinancials() in sales.service.js — that is the single
// source of truth for cash_in_hand, realized profit and the petty vs
// operating split, and analytics/record/statement all read from it.
// A second composer in this file would be a plausible-looking rival
// implementation of the same numbers, which is exactly the drift this
// file exists to prevent. Add period math to getStatementFinancials;
// add per-transaction rules here.
// ─────────────────────────────────────────────────────────────────────────