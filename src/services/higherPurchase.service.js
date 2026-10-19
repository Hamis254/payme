/**
 * =============================================================================
 * SERVICE: HIRE PURCHASE
 * =============================================================================
 * Stock and money run on two different clocks here, on purpose:
 *
 *  - Goods do NOT leave the shop at signing — they're only RESERVED
 *    (held, unsellable — see reserveStockFIFO in sales.service.js /
 *    stock.service.js). Real FIFO deduction only happens once the
 *    agreement is fully paid off (finalizeAgreementStockDeduction below).
 *
 *  - Cost is unknown for real until then, so a catalog-based ESTIMATE
 *    (estimated_cost) is snapshotted at signing, purely to track
 *    cost-recovery progress as payments come in. It's reconciled
 *    against the true FIFO cost the moment the agreement is finalized.
 *
 *  - The deposit, if any, is recorded immediately as the agreement's
 *    first payment (payment_type: 'deposit') in
 *    hirePurchaseInstallmentPayments — real cash, the day it's
 *    actually received, same treatment as any installment.
 *
 *  - sales.total_profit stays 0 forever for an HP sale — profit
 *    realized from deposits/installments lives on
 *    hirePurchaseInstallmentPayments rows, dated by the day each
 *    payment actually happened. That's what lets daily/monthly figures
 *    attribute profit to the day money landed, not the day the
 *    agreement was signed.
 * =============================================================================
 */

import { db, sql } from '#config/database.js';
import { creditAccounts } from '#models/credit.model.js';
import { customers } from '#models/customer.model.js';
import { saleItems } from '#models/sales.model.js';
import { products } from '#models/stock.model.js';
import {
  hirePurchaseAgreements,
  hirePurchaseInstallments,
  hirePurchaseInstallmentPayments,
} from '#models/higherPurchase.model.js';
import { and, eq, gte, lte, desc, ne, inArray, sql as sqlOp } from 'drizzle-orm';
import logger from '#config/logger.js';
import { calculateHPPayment } from '#services/financialCalculations.js';
import { deductStockFIFO, releaseStockReservation } from '#services/stock.service.js';

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Create a new hire purchase agreement.
 *
 * Stock was already RESERVED (not deducted) by sales.service.js when the
 * sale row was created. Cost is unknown for real until the agreement is
 * fully paid, so a catalog-based estimate is snapshotted here.
 *
 * @param {Object} data - Agreement data
 * @param {object|null} [trx] - optional external transaction client. When
 *   processPayMe is running the whole sale (stock deduction/reservation,
 *   sale row, this agreement + its installments, and the token-deduction
 *   ledger entry) as one atomic unit, this needs to write into THAT SAME
 *   transaction rather than opening its own — opening a second,
 *   independent transaction here was exactly what let a hire purchase
 *   sale report failure back to the client while the stock reservation
 *   from createSale(), already committed under the caller's separate
 *   transaction, stayed in place. Any other caller that doesn't supply a
 *   trx gets the old behavior: this function opens and manages its own
 *   transaction as before.
 * @returns {Promise<Object>} Created agreement with installments
 */
export async function createAgreement(data, trx = null) {
  try {
    const {
      saleId,
      accountId,
      businessId,
      principalAmount,
      interestRate,
      downPayment,
      installmentAmount,
      installmentFrequency,
      numberOfInstallments,
      agreementDate,
      firstPaymentDate,
      finalPaymentDate,
      lateFeeAmount,
      gracePeriodDays,
      termsAndConditions,
      notes,
      createdBy,
      paymentMethod, // for the deposit, if any — 'cash' | 'mpesa'
    } = data;

    const parsedPrincipal = Number(principalAmount);
    const parsedInterestRate = Number(interestRate);
    const parsedDownPayment = Number(downPayment);
    const parsedInstallmentAmount = Number(installmentAmount);
    const parsedInstallments = Number(numberOfInstallments);

    if (!saleId || !accountId || !businessId) {
      throw new Error('saleId, accountId, and businessId are required');
    }
    if (!Number.isFinite(parsedPrincipal) || parsedPrincipal <= 0) {
      throw new Error('principalAmount must be a positive number');
    }
    if (!Number.isFinite(parsedInterestRate) || parsedInterestRate < 0) {
      throw new Error('interestRate must be a non-negative number');
    }
    if (!Number.isFinite(parsedDownPayment) || parsedDownPayment < 0) {
      throw new Error('downPayment must be a non-negative number');
    }
    if (parsedDownPayment > parsedPrincipal) {
      throw new Error('downPayment cannot exceed the principal amount');
    }
    if (!Number.isFinite(parsedInstallmentAmount) || parsedInstallmentAmount <= 0) {
      throw new Error('installmentAmount must be a positive number');
    }
    if (!Number.isInteger(parsedInstallments) || parsedInstallments <= 0) {
      throw new Error('numberOfInstallments must be a positive integer');
    }
    if (!['daily', 'weekly', 'bi-weekly', 'monthly'].includes(installmentFrequency)) {
      throw new Error('installmentFrequency must be daily, weekly, bi-weekly, or monthly');
    }

    const totalAmount = parsedPrincipal * (1 + parsedInterestRate / 100);
    const amountFinanced = totalAmount - parsedDownPayment;

    const runInTransaction = async tx => {
      // Catalog-based cost estimate — buying price lives on `products`,
      // not `saleItems`, so this needs a join. Written explicitly rather
      // than packed into one SQL expression since this is money-critical.
      const items = await tx
        .select({
          quantity: saleItems.quantity,
          product_id: saleItems.product_id,
        })
        .from(saleItems)
        .where(eq(saleItems.sale_id, saleId));

      let estimatedCost = 0;
      for (const item of items) {
        const [product] = await tx
          .select({ buying_price_per_unit: products.buying_price_per_unit })
          .from(products)
          .where(eq(products.id, item.product_id))
          .limit(1);
        estimatedCost += Number(product?.buying_price_per_unit || 0) * Number(item.quantity);
      }
      estimatedCost = round2(estimatedCost);

      const [agreement] = await tx
        .insert(hirePurchaseAgreements)
        .values({
          sale_id: saleId,
          account_id: accountId,
          business_id: businessId,
          principal_amount: principalAmount.toString(),
          interest_rate: interestRate.toString(),
          total_amount: totalAmount.toString(),
          down_payment: downPayment.toString(),
          amount_financed: amountFinanced.toString(),
          estimated_cost: estimatedCost.toString(),
          installment_amount: installmentAmount.toString(),
          installment_frequency: installmentFrequency,
          number_of_installments: numberOfInstallments,
          installments_paid: 0,
          agreement_date: new Date(agreementDate),
          first_payment_date: new Date(firstPaymentDate),
          final_payment_date: new Date(finalPaymentDate),
          balance_remaining: totalAmount.toString(), // nothing received yet — see deposit below
          status: 'active',
          late_fee_amount: lateFeeAmount?.toString(),
          grace_period_days: gracePeriodDays,
          terms_and_conditions: termsAndConditions,
          notes,
          created_by: createdBy,
        })
        .returning();

      // Scheduled installments — unchanged structure, numbered 1..N.
      const installments = [];
      let currentDate = new Date(firstPaymentDate);
      for (let i = 1; i <= numberOfInstallments; i++) {
        const [installment] = await tx
          .insert(hirePurchaseInstallments)
          .values({
            agreement_id: agreement.id,
            installment_number: i,
            due_date: currentDate,
            amount_due: installmentAmount.toString(),
            status: 'pending',
          })
          .returning();
        installments.push(installment);

        currentDate = new Date(currentDate);
        if (installmentFrequency === 'daily') currentDate.setDate(currentDate.getDate() + 1);
        else if (installmentFrequency === 'weekly') currentDate.setDate(currentDate.getDate() + 7);
        else if (installmentFrequency === 'bi-weekly') currentDate.setDate(currentDate.getDate() + 14);
        else if (installmentFrequency === 'monthly') currentDate.setMonth(currentDate.getMonth() + 1);
      }

      // ── Deposit: real cash, received today, tagged distinctly ──────
      let depositRecord = null;
      let finalAgreement = agreement;
      if (parsedDownPayment > 0) {
        const progress = calculateHPPayment({
          totalCost: estimatedCost,
          totalSaleValue: totalAmount,
          amountReceivedBeforeThisPayment: 0,
          paymentAmount: parsedDownPayment,
          paymentType: 'deposit',
        });

        [depositRecord] = await tx
          .insert(hirePurchaseInstallmentPayments)
          .values({
            agreement_id: agreement.id,
            installment_id: null,
            payment_type: 'deposit',
            amount: String(parsedDownPayment),
            payment_method: paymentMethod || 'cash',
            cost_recovered: String(progress.cost_recovered_this_payment),
            profit_realized: String(progress.profit_realized_this_payment),
            payment_date: new Date(agreementDate),
          })
          .returning();

        [finalAgreement] = await tx
          .update(hirePurchaseAgreements)
          .set({
            balance_remaining: String(progress.outstanding_balance),
            // Extremely rare edge case: deposit alone covers the full
            // price. Still respect it — don't force a customer through
            // installments they've already finished paying.
            status: progress.fully_paid ? 'completed' : 'active',
            updated_at: new Date(),
          })
          .where(eq(hirePurchaseAgreements.id, agreement.id))
          .returning();

        if (progress.should_deduct_stock) {
          await finalizeAgreementStockDeduction(tx, agreement.id, saleId, estimatedCost);
        }
      }

      return { agreement: finalAgreement, installments, deposit: depositRecord };
    };

    const result = trx ? await runInTransaction(trx) : await db.transaction(runInTransaction);

    logger.info(`Hire purchase agreement created: ${result.agreement.id}`, {
      agreementId: result.agreement.id,
      saleId,
      installments: result.installments.length,
      depositTaken: !!result.deposit,
    });

    return result;
  } catch (error) {
    logger.error('Error creating agreement:', error);
    throw error;
  }
}

/**
 * Get a single agreement with its installment schedule. Unchanged.
 */
export async function getAgreementById(agreementId) {
  try {
    const agreement = await db
      .select()
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.id, agreementId))
      .limit(1);

    if (!agreement.length) return null;

    const installments = await db
      .select()
      .from(hirePurchaseInstallments)
      .where(eq(hirePurchaseInstallments.agreement_id, agreementId))
      .orderBy(hirePurchaseInstallments.installment_number);

    return {
      ...agreement[0],
      installments,
      principal_amount: parseFloat(agreement[0].principal_amount),
      total_amount: parseFloat(agreement[0].total_amount),
      down_payment: parseFloat(agreement[0].down_payment),
      amount_financed: parseFloat(agreement[0].amount_financed),
      installment_amount: parseFloat(agreement[0].installment_amount),
      balance_remaining: parseFloat(agreement[0].balance_remaining),
      late_fee_amount: parseFloat(agreement[0].late_fee_amount),
    };
  } catch (error) {
    logger.error('Error fetching agreement:', error);
    throw error;
  }
}

/**
 * List agreements with filters. Unchanged.
 * @param {Object} params - Query parameters
 * @returns {Promise<Array>} Agreements list
 */
export async function listAgreements(params) {
  try {
    const { businessId, status, startDate, endDate, limit = 50, offset = 0 } = params;

    const conditions = [eq(hirePurchaseAgreements.business_id, businessId)];
    if (status) conditions.push(eq(hirePurchaseAgreements.status, status));
    if (startDate && endDate) {
      conditions.push(
        gte(hirePurchaseAgreements.agreement_date, new Date(startDate)),
        lte(hirePurchaseAgreements.agreement_date, new Date(endDate))
      );
    }

    const results = await db
      .select({
        id: hirePurchaseAgreements.id,
        sale_id: hirePurchaseAgreements.sale_id,
        account_id: hirePurchaseAgreements.account_id,
        customer_name: creditAccounts.customer_name,
        principal_amount: hirePurchaseAgreements.principal_amount,
        total_amount: hirePurchaseAgreements.total_amount,
        down_payment: hirePurchaseAgreements.down_payment,
        amount_financed: hirePurchaseAgreements.amount_financed,
        installment_amount: hirePurchaseAgreements.installment_amount,
        installment_frequency: hirePurchaseAgreements.installment_frequency,
        number_of_installments: hirePurchaseAgreements.number_of_installments,
        installments_paid: hirePurchaseAgreements.installments_paid,
        balance_remaining: hirePurchaseAgreements.balance_remaining,
        status: hirePurchaseAgreements.status,
        agreement_date: hirePurchaseAgreements.agreement_date,
        first_payment_date: hirePurchaseAgreements.first_payment_date,
        final_payment_date: hirePurchaseAgreements.final_payment_date,
      })
      .from(hirePurchaseAgreements)
      .leftJoin(creditAccounts, eq(hirePurchaseAgreements.account_id, creditAccounts.id))
      .where(and(...conditions))
      .orderBy(desc(hirePurchaseAgreements.agreement_date))
      .limit(limit)
      .offset(offset);

    return results.map(r => ({
      ...r,
      principal_amount: parseFloat(r.principal_amount),
      total_amount: parseFloat(r.total_amount),
      down_payment: parseFloat(r.down_payment),
      amount_financed: parseFloat(r.amount_financed),
      installment_amount: parseFloat(r.installment_amount),
      balance_remaining: parseFloat(r.balance_remaining),
    }));
  } catch (error) {
    logger.error('Error listing agreements:', error);
    throw error;
  }
}

/**
 * Get every hire purchase agreement for a business, joined with the
 * account (customer_name), the customer's phone, the underlying sale's
 * line items (for a "products bought" summary), and each agreement's
 * next pending installment. Unchanged.
 *
 * @param {number} businessId - Business ID
 * @returns {Promise<{ hire_purchase_sales: Array }>}
 */
export async function getHirePurchaseSalesForBusiness(businessId, params = {}) {
  try {
    const { status, startDate, endDate, limit = 50, offset = 0 } = params;
    const conditions = [eq(hirePurchaseAgreements.business_id, businessId)];

    if (status) {
      conditions.push(eq(hirePurchaseAgreements.status, status));
    }

    if (startDate && endDate) {
      conditions.push(
        gte(hirePurchaseAgreements.agreement_date, new Date(startDate)),
        lte(hirePurchaseAgreements.agreement_date, new Date(endDate))
      );
    }

    const rows = await db
      .select({
        id: hirePurchaseAgreements.id,
        sale_id: hirePurchaseAgreements.sale_id,
        account_id: hirePurchaseAgreements.account_id,
        customer_name: creditAccounts.customer_name,
        customer_id: creditAccounts.customer_id,
        principal_amount: hirePurchaseAgreements.principal_amount,
        total_amount: hirePurchaseAgreements.total_amount,
        down_payment: hirePurchaseAgreements.down_payment,
        amount_financed: hirePurchaseAgreements.amount_financed,
        installment_amount: hirePurchaseAgreements.installment_amount,
        installment_frequency: hirePurchaseAgreements.installment_frequency,
        number_of_installments: hirePurchaseAgreements.number_of_installments,
        installments_paid: hirePurchaseAgreements.installments_paid,
        balance_remaining: hirePurchaseAgreements.balance_remaining,
        status: hirePurchaseAgreements.status,
        agreement_date: hirePurchaseAgreements.agreement_date,
        final_payment_date: hirePurchaseAgreements.final_payment_date,
        created_at: hirePurchaseAgreements.created_at,
      })
      .from(hirePurchaseAgreements)
      // account_id is NOT NULL with a hard FK to credit_accounts, so an
      // inner join is safe here (unlike the best-effort customer join
      // below) — every agreement is guaranteed to have a matching account.
      .innerJoin(creditAccounts, eq(hirePurchaseAgreements.account_id, creditAccounts.id))
      .where(and(...conditions))
      .orderBy(desc(hirePurchaseAgreements.agreement_date))
      .limit(limit)
      .offset(offset);

    const summary = {
      total_agreements: rows.length,
      active_agreements: rows.filter(r => r.status === 'active').length,
      completed_agreements: rows.filter(r => r.status === 'completed').length,
      defaulted_agreements: rows.filter(r => r.status === 'defaulted').length,
      cancelled_agreements: rows.filter(r => r.status === 'cancelled').length,
      total_financed: Number(
        rows.reduce((sum, r) => sum + Number(r.amount_financed || 0), 0).toFixed(2)
      ),
      total_remaining: Number(
        rows.reduce((sum, r) => sum + Number(r.balance_remaining || 0), 0).toFixed(2)
      ),
      total_collected: Number(
        rows
          .reduce((sum, r) => sum + (Number(r.total_amount || 0) - Number(r.balance_remaining || 0)), 0)
          .toFixed(2)
      ),
    };

    if (rows.length === 0) {
      return { hire_purchase_sales: [], summary };
    }

    const agreementIds = rows.map(r => r.id);
    const saleIds = rows.map(r => r.sale_id);

    const items = await db
      .select({
        sale_id: saleItems.sale_id,
        product_name: saleItems.product_name,
        quantity: saleItems.quantity,
      })
      .from(saleItems)
      .where(inArray(saleItems.sale_id, saleIds));

    const itemsBySale = {};
    for (const item of items) {
      (itemsBySale[item.sale_id] ??= []).push(`${item.product_name} x${Number(item.quantity)}`);
    }

    const customerIds = [...new Set(rows.map(r => r.customer_id))];
    const customerRows = customerIds.length
      ? await db.select({ id: customers.id, phone: customers.phone }).from(customers).where(inArray(customers.id, customerIds))
      : [];
    const phoneByCustomerId = Object.fromEntries(customerRows.map(c => [c.id, c.phone]));

    const pendingInstallments = await db
      .select({
        agreement_id: hirePurchaseInstallments.agreement_id,
        installment_number: hirePurchaseInstallments.installment_number,
        due_date: hirePurchaseInstallments.due_date,
        amount_due: hirePurchaseInstallments.amount_due,
      })
      .from(hirePurchaseInstallments)
      .where(and(inArray(hirePurchaseInstallments.agreement_id, agreementIds), ne(hirePurchaseInstallments.status, 'paid')))
      .orderBy(hirePurchaseInstallments.due_date);

    const nextInstallmentByAgreement = {};
    for (const inst of pendingInstallments) {
      if (!nextInstallmentByAgreement[inst.agreement_id]) {
        nextInstallmentByAgreement[inst.agreement_id] = {
          installment_number: inst.installment_number,
          due_date: inst.due_date,
          amount_due: parseFloat(inst.amount_due),
        };
      }
    }

    const result = rows.map(r => ({
      id: r.id,
      sale_id: r.sale_id,
      account_id: r.account_id,
      customer_name: r.customer_name,
      customer_phone: phoneByCustomerId[r.customer_id] || null,
      products: (itemsBySale[r.sale_id] || []).join(', '),
      principal_amount: parseFloat(r.principal_amount),
      total_amount: parseFloat(r.total_amount),
      down_payment: parseFloat(r.down_payment),
      amount_financed: parseFloat(r.amount_financed),
      installment_amount: parseFloat(r.installment_amount),
      installment_frequency: r.installment_frequency,
      number_of_installments: r.number_of_installments,
      installments_paid: r.installments_paid,
      installments_remaining: r.number_of_installments - r.installments_paid,
      balance_remaining: parseFloat(r.balance_remaining),
      status: r.status,
      agreement_date: r.agreement_date,
      final_payment_date: r.final_payment_date,
      next_installment: nextInstallmentByAgreement[r.id] || null,
      created_at: r.created_at,
    }));

    return { hire_purchase_sales: result, summary };
  } catch (error) {
    logger.error('Error fetching hire purchase sales for business:', error);
    throw error;
  }
}

/**
 * Record a payment against a scheduled installment.
 *
 * Cost-recovery-first, same rule as credit. The moment cumulative
 * payments clear the agreement's cost basis, should_deduct_stock fires
 * and finalizeAgreementStockDeduction() runs the REAL FIFO deduction for
 * the first time — that's also when the catalog-based estimated_cost
 * gets trued-up against reality.
 */
export async function recordInstallmentPayment(data) {
  try {
    const { agreementId, installmentId, amountPaid, paymentMethod, mpesaTransactionId, paymentDate } = data;
    const payment = round2(parseFloat(amountPaid));

    const result = await db.transaction(async tx => {
      const [installment] = await tx
        .select()
        .from(hirePurchaseInstallments)
        .where(eq(hirePurchaseInstallments.id, installmentId))
        .limit(1);
      if (!installment) throw new Error('Installment not found');

      const [agreement] = await tx
        .select()
        .from(hirePurchaseAgreements)
        .where(eq(hirePurchaseAgreements.id, agreementId))
        .limit(1);
      if (!agreement) throw new Error('Agreement not found');

      const totalAmount = Number(agreement.total_amount);

      // estimated_cost is nullable by design — a 0 default would book every
      // installment as pure profit. If it's missing the agreement predates
      // the column and was never backfilled, so there is no cost basis and
      // no honest split to write. Fail the transaction rather than bank a
      // fabricated profit figure.
      if (
        agreement.estimated_cost === null ||
        agreement.estimated_cost === undefined
      ) {
        throw new Error(
          `Agreement ${agreementId} has no estimated_cost, so this payment ` +
            'cannot be split into cost recovery and profit. Backfill the ' +
            'agreement instead of recording a payment with an unverifiable split.'
        );
      }
      const estimatedCost = Number(agreement.estimated_cost);
      const amountReceivedBeforeThisPayment = round2(totalAmount - Number(agreement.balance_remaining));

      const progress = calculateHPPayment({
        totalCost: estimatedCost,
        totalSaleValue: totalAmount,
        amountReceivedBeforeThisPayment,
        paymentAmount: payment,
        paymentType: 'installment',
      });

      const amountDue = parseFloat(installment.amount_due);
      const previouslyPaid = parseFloat(installment.amount_paid || 0);
      const totalPaid = round2(previouslyPaid + payment);
      const newStatus = totalPaid >= amountDue ? 'paid' : 'partial';

      const [updatedInstallment] = await tx
        .update(hirePurchaseInstallments)
        .set({
          amount_paid: totalPaid.toString(),
          payment_date: new Date(paymentDate || new Date()),
          payment_method: paymentMethod,
          mpesa_transaction_id: mpesaTransactionId,
          status: newStatus,
          updated_at: new Date(),
        })
        .where(eq(hirePurchaseInstallments.id, installmentId))
        .returning();

      // Append-only payment event — this is what getStatementFinancials
      // reads from, so partial-payment history is never overwritten the
      // way it would be if only the row above were updated.
      await tx.insert(hirePurchaseInstallmentPayments).values({
        agreement_id: agreementId,
        installment_id: installmentId,
        payment_type: 'installment',
        amount: String(payment),
        payment_method: paymentMethod,
        mpesa_transaction_id: mpesaTransactionId || null,
        cost_recovered: String(progress.cost_recovered_this_payment),
        profit_realized: String(progress.profit_realized_this_payment),
        payment_date: new Date(paymentDate || new Date()),
      });

      const newInstallmentsPaid = newStatus === 'paid' ? agreement.installments_paid + 1 : agreement.installments_paid;

      const [updatedAgreement] = await tx
        .update(hirePurchaseAgreements)
        .set({
          balance_remaining: String(progress.outstanding_balance),
          installments_paid: newInstallmentsPaid,
          status: progress.fully_paid ? 'completed' : 'active',
          updated_at: new Date(),
        })
        .where(eq(hirePurchaseAgreements.id, agreementId))
        .returning();

      if (progress.should_deduct_stock) {
        await finalizeAgreementStockDeduction(tx, agreementId, agreement.sale_id, estimatedCost);
      }

      return { installment: updatedInstallment, agreement: updatedAgreement };
    });

    logger.info(`Installment payment recorded: ${installmentId}`, {
      installmentId,
      agreementId,
      amount: payment,
      method: paymentMethod,
    });

    return result;
  } catch (error) {
    logger.error('Error recording installment payment:', error);
    throw error;
  }
}

/**
 * Runs exactly once per agreement — the moment it's fully paid off.
 * Goods finally, actually leave the shop: real FIFO deduction runs for
 * the first time, the reservation is released, and saleItems get
 * backfilled with the TRUE cost/profit. Real FIFO cost can differ
 * slightly from the catalog estimate (stock bought at a different price
 * since signing) — the difference is booked as a one-line true-up on
 * the most recent payment so cumulative profit_realized across the
 * agreement always foots to (total_amount − real_total_cost) exactly.
 */
async function finalizeAgreementStockDeduction(tx, agreementId, saleId, estimatedCost) {
  const items = await tx.select().from(saleItems).where(eq(saleItems.sale_id, saleId));

  let realTotalCost = 0;
  for (const item of items) {
    const deduction = await deductStockFIFO(item.product_id, Number(item.quantity), tx);
    const totalCost = deduction.deductions.reduce((sum, d) => sum + d.total_cost, 0);
    realTotalCost += totalCost;

    await tx
      .update(saleItems)
      .set({
        unit_cost: String(deduction.deductions.length ? totalCost / Number(item.quantity) : 0),
        profit: String(round2(Number(item.total_price) - totalCost)),
      })
      .where(eq(saleItems.id, item.id));

    await releaseStockReservation(item.product_id, Number(item.quantity), tx);
  }
  realTotalCost = round2(realTotalCost);

  const trueUpAmount = round2(estimatedCost - realTotalCost);

  if (trueUpAmount !== 0) {
    const [lastPaidRow] = await tx
      .select()
      .from(hirePurchaseInstallmentPayments)
      .where(eq(hirePurchaseInstallmentPayments.agreement_id, agreementId))
      .orderBy(desc(hirePurchaseInstallmentPayments.payment_date))
      .limit(1);

    if (lastPaidRow) {
      await tx
        .update(hirePurchaseInstallmentPayments)
        .set({
          profit_realized: String(round2(Number(lastPaidRow.profit_realized) + trueUpAmount)),
        })
        .where(eq(hirePurchaseInstallmentPayments.id, lastPaidRow.id));
    }

    logger.info('HP agreement cost true-up applied', { agreementId, estimatedCost, realTotalCost, trueUpAmount });
  }
}

/**
 * Get overdue installments. Unchanged.
 */
export async function getOverdueInstallments(businessId) {
  try {
    const today = new Date();

    const result = await db
      .select({
        installment_id: hirePurchaseInstallments.id,
        installment_number: hirePurchaseInstallments.installment_number,
        due_date: hirePurchaseInstallments.due_date,
        amount_due: hirePurchaseInstallments.amount_due,
        amount_paid: hirePurchaseInstallments.amount_paid,
        days_overdue: sql`CAST(EXTRACT(DAY FROM NOW() - due_date) AS INTEGER)`,
        agreement_id: hirePurchaseAgreements.id,
        principal_amount: hirePurchaseAgreements.principal_amount,
        status: hirePurchaseAgreements.status,
      })
      .from(hirePurchaseInstallments)
      .innerJoin(hirePurchaseAgreements, eq(hirePurchaseInstallments.agreement_id, hirePurchaseAgreements.id))
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          eq(hirePurchaseAgreements.status, 'active'),
          ne(hirePurchaseInstallments.status, 'paid'),
          sqlOp`due_date < ${today}`
        )
      )
      .orderBy(desc(hirePurchaseInstallments.due_date));

    return result.map(r => ({
      ...r,
      amount_due: parseFloat(r.amount_due),
      amount_paid: parseFloat(r.amount_paid || 0),
      principal_amount: parseFloat(r.principal_amount),
      days_overdue: parseInt(r.days_overdue) || 0,
    }));
  } catch (error) {
    logger.error('Error fetching overdue installments:', error);
    throw error;
  }
}

/**
 * Get upcoming installments. Unchanged.
 * @param {number} businessId - Business ID
 * @param {number} daysAhead - Number of days to look ahead (default 30)
 */
export async function getUpcomingInstallments(businessId, daysAhead = 30) {
  try {
    const today = new Date();
    const futureDate = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const result = await db
      .select({
        installment_id: hirePurchaseInstallments.id,
        installment_number: hirePurchaseInstallments.installment_number,
        due_date: hirePurchaseInstallments.due_date,
        amount_due: hirePurchaseInstallments.amount_due,
        agreement_id: hirePurchaseAgreements.id,
        status: hirePurchaseAgreements.status,
      })
      .from(hirePurchaseInstallments)
      .innerJoin(hirePurchaseAgreements, eq(hirePurchaseInstallments.agreement_id, hirePurchaseAgreements.id))
      .where(
        and(
          eq(hirePurchaseAgreements.business_id, businessId),
          eq(hirePurchaseAgreements.status, 'active'),
          eq(hirePurchaseInstallments.status, 'pending'),
          gte(hirePurchaseInstallments.due_date, today),
          lte(hirePurchaseInstallments.due_date, futureDate)
        )
      )
      .orderBy(hirePurchaseInstallments.due_date);

    return result.map(r => ({ ...r, amount_due: parseFloat(r.amount_due) }));
  } catch (error) {
    logger.error('Error fetching upcoming installments:', error);
    throw error;
  }
}

/**
 * Calculate agreement summary. Unchanged — total_collected (amount_financed
 * − balance_remaining) stays accurate since balance_remaining is now
 * correctly maintained by recordInstallmentPayment/createAgreement above.
 */
export async function getAgreementSummary(businessId) {
  try {
    const result = await db
      .select({
        total_agreements: sql`COUNT(*)`,
        active_agreements: sql`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
        completed_agreements: sql`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        defaulted_agreements: sql`SUM(CASE WHEN status = 'defaulted' THEN 1 ELSE 0 END)`,
        total_financed: sql`SUM(CAST(amount_financed AS DECIMAL))`,
        total_remaining: sql`SUM(CAST(balance_remaining AS DECIMAL))`,
        total_collected: sql`SUM(CAST(amount_financed AS DECIMAL)) - SUM(CAST(balance_remaining AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    return {
      total_agreements: parseInt(result[0].total_agreements) || 0,
      active_agreements: parseInt(result[0].active_agreements) || 0,
      completed_agreements: parseInt(result[0].completed_agreements) || 0,
      defaulted_agreements: parseInt(result[0].defaulted_agreements) || 0,
      total_financed: parseFloat(result[0].total_financed) || 0,
      total_remaining: parseFloat(result[0].total_remaining) || 0,
      total_collected: parseFloat(result[0].total_collected) || 0,
    };
  } catch (error) {
    logger.error('Error calculating summary:', error);
    throw error;
  }
}

/**
 * Get agreement status distribution. Unchanged.
 */
export async function getStatusDistribution(businessId) {
  try {
    const result = await db
      .select({
        status: hirePurchaseAgreements.status,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount_financed AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId))
      .groupBy(hirePurchaseAgreements.status);

    return result.reduce((acc, row) => {
      acc[row.status] = { count: parseInt(row.count), amount: parseFloat(row.total_amount) };
      return acc;
    }, {});
  } catch (error) {
    logger.error('Error getting status distribution:', error);
    throw error;
  }
}

/**
 * Update agreement status. Unchanged.
 */
export async function updateAgreementStatus(agreementId, status) {
  try {
    const [updated] = await db
      .update(hirePurchaseAgreements)
      .set({ status, updated_at: new Date() })
      .where(eq(hirePurchaseAgreements.id, agreementId))
      .returning();

    logger.info(`Agreement ${agreementId} status updated to ${status}`);
    return updated;
  } catch (error) {
    logger.error('Error updating status:', error);
    throw error;
  }
}

/**
 * Get installment payment history.
 *
 * NOTE: this still reads from hirePurchaseInstallments (the schedule
 * table), which only shows the CURRENT cumulative state per scheduled
 * slot — the same partial-payment history gap that getStatementFinancials
 * was fixed to avoid by reading hirePurchaseInstallmentPayments instead.
 * Not changed here since it wasn't reported broken, but worth switching
 * this to read from hirePurchaseInstallmentPayments too if this screen
 * ever needs to show individual partial payments rather than per-slot
 * totals — say the word if you want that now.
 */
export async function getPaymentHistory(agreementId) {
  try {
    const result = await db
      .select()
      .from(hirePurchaseInstallments)
      .where(eq(hirePurchaseInstallments.agreement_id, agreementId))
      .orderBy(hirePurchaseInstallments.installment_number);

    return result.map(r => ({
      ...r,
      amount_due: parseFloat(r.amount_due),
      amount_paid: parseFloat(r.amount_paid || 0),
    }));
  } catch (error) {
    logger.error('Error fetching payment history:', error);
    throw error;
  }
}

/**
 * Calculate collection rate. Unchanged.
 */
export async function getCollectionRate(businessId) {
  try {
    const result = await db
      .select({
        total: sql`SUM(CAST(amount_financed AS DECIMAL))`,
        collected: sql`SUM(CAST(amount_financed AS DECIMAL)) - SUM(CAST(balance_remaining AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId));

    const total = parseFloat(result[0].total) || 0;
    if (total === 0) return 0;

    const collected = parseFloat(result[0].collected) || 0;
    return (collected / total) * 100;
  } catch (error) {
    logger.error('Error calculating collection rate:', error);
    throw error;
  }
}

/**
 * Get revenue by installment frequency. Unchanged.
 */
export async function getRevenueByFrequency(businessId) {
  try {
    const result = await db
      .select({
        frequency: hirePurchaseAgreements.installment_frequency,
        count: sql`COUNT(*)`,
        total_amount: sql`SUM(CAST(amount_financed AS DECIMAL))`,
        avg_amount: sql`AVG(CAST(amount_financed AS DECIMAL))`,
      })
      .from(hirePurchaseAgreements)
      .where(eq(hirePurchaseAgreements.business_id, businessId))
      .groupBy(hirePurchaseAgreements.installment_frequency);

    return result.map(r => ({
      frequency: r.frequency,
      count: parseInt(r.count),
      total_amount: parseFloat(r.total_amount),
      avg_amount: parseFloat(r.avg_amount),
    }));
  } catch (error) {
    logger.error('Error getting revenue by frequency:', error);
    throw error;
  }
}