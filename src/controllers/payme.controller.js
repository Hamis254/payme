import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  paymeSchema,
  validateCartSchema,
} from '#validations/payme.validation.js';
// Namespace import, matching credit/record above: every call site in this
// file is written as saleService.x(). These were previously named imports
// while the call sites said saleService.x(), so all seven threw
// "ReferenceError: saleService is not defined" at runtime — including
// checkout and sale creation.
import * as saleService from '#services/sales.service.js';
import { businessDayRange } from '#utils/businessDay.js';
import { getPaymentConfig } from '#services/paymentConfig.service.js';
import { initiateBusinessPayment } from '#utils/mpesa.js';
import { createCreditSale, assessCreditStockRisk } from '#services/credit.service.js';
import { createAgreement } from '#services/higherPurchase.service.js';
import { createRecord } from '#services/record.service.js';
import { db } from '#config/database.js';
import { wallets } from '#models/myWallet.model.js';
import { mpesaAttempts } from '#models/mpesaAttempt.model.js';
import {
  stageAttempt,
  attachCheckoutRequestId,
  abandonAttempt,
} from '#services/mpesaAttempt.service.js';
import { eq } from 'drizzle-orm';

class CreditStockRiskWarning extends Error {
  constructor(risk) {
    super('Credit stock risk warning');
    this.name = 'CreditStockRiskWarning';
    this.risk = risk;
  }
}

// ─────────────────────────────────────────────
// PREVIEW CART
// POST /api/payme/preview
// Validates items and returns totals before payment — no sale created
// ─────────────────────────────────────────────

export const previewCart = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = validateCartSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { business_id, items } = validationResult.data;

    const cart = await saleService.validateAndCalculateCart(
      req.user.id,
      business_id,
      items
    );

    res.status(200).json({
      message: 'Cart validated successfully',
      business_name: cart.business.name,
      items: cart.items,
      total_amount: cart.total_amount,
      items_count: cart.items_count,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    if (e.message.includes('Product') && e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }
    if (e.message.includes('Insufficient stock')) {
      return res.status(400).json({ error: e.message });
    }
    logger.error('Error previewing cart', e);
    next(e);
  }
};

// ─────────────────────────────────────────────
// PROCESS PAYME
// POST /api/payme/
// Sole entry point for all sale creation.
// Handles cash, M-Pesa, credit, and hire purchase.
//
// Every sale of every payment mode requires a positive token balance
// before it's allowed to start — checked once, up front, below. For
// cash/credit/hire_purchase, the sale itself, the payment-mode-specific
// record, and the token deduction + ledger entry all run inside ONE
// transaction, so a failure partway through leaves nothing half-done —
// previously, createSale() ran outside any shared transaction, so a
// credit or hire-purchase sale could report failure to the client while
// its stock deduction had already committed. M-Pesa is deliberately
// different: the token is only ever charged in the callback once the
// customer has actually paid (resultCode === 0) — money already
// received can't be rolled back by refusing the sale afterward, so this
// upfront check exists there purely to stop a 0-token business from
// even starting an STK push it already knows can't be billed.
//
// M-Pesa is also the one mode that does NOT create a sale here. It stages
// an attempt (mpesa_attempts) with the stock held, and returns 202 —
// the sale is born in the callback, only on confirmed payment.
// ─────────────────────────────────────────────

export const processPayMe = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = paymeSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const {
      business_id,
      items,
      payment_mode,
      customer_phone,
      customer_name,
      customer_type,
      note,
      // Credit fields
      credit_account_id,
      credit_due_date,
      override_stock_warning,
      // Hire Purchase fields
      hp_account_id,
      hp_interest_rate,
      hp_down_payment,
      hp_installment_amount,
      hp_installment_frequency,
      hp_number_of_installments,
      hp_first_payment_date,
    } = validationResult.data;

    // For M-Pesa, validate payment config EXISTS before creating a sale
    if (payment_mode === 'mpesa') {
      const paymentConfig = await getPaymentConfig(business_id);
      if (!paymentConfig) {
        return res.status(400).json({
          error: 'Payment configuration not found',
          hint: 'Please setup your M-Pesa payment method first',
          setup_url: '/api/payment-config/fields?method=paybill',
        });
      }
      if (!paymentConfig.is_active) {
        return res.status(400).json({
          error: 'Payment configuration is inactive',
          hint: 'Please activate or reconfigure your M-Pesa credentials in Settings',
        });
      }
    }

    // ══════════════════════════════════════════
    // TOKEN GATE — no sale of any payment mode starts without at least
    // one token available. This is the app's revenue mechanism.
    // ══════════════════════════════════════════
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.business_id, business_id))
      .limit(1);

    if (!wallet || wallet.balance_tokens < 1) {
      return res.status(402).json({
        error: 'Insufficient token balance',
        message: 'Token balance is 0. Please top up your wallet to continue selling.',
        code: 'INSUFFICIENT_TOKENS',
      });
    }

    let result;
    let response;

    if (payment_mode === 'mpesa') {
      // ══════════════════════════════════════════
      // M-PESA — stage the attempt, then initiate the STK push.
      //
      // NO sale row is created here. An STK push is a request for money;
      // until Safaricom confirms resultCode === 0 there is no sale, so
      // nothing is written to `sales` and nothing appears on the ledger.
      // The cart is parked in mpesa_attempts with the stock HELD (reserved,
      // not deducted) — that hold is what stops two simultaneous pushes
      // from both being promised the same last unit. See
      // mpesaAttempt.service.js for the full flow.
      // ══════════════════════════════════════════
      let staged;

      try {
        staged = await stageAttempt({
          userId: req.user.id,
          businessId: business_id,
          items,
          phone: customer_phone,
          customerName: customer_name,
          customerType: customer_type,
          note,
        });
      } catch (stageError) {
        logger.error('Failed to stage M-Pesa attempt', stageError);
        if (stageError.message?.includes('Insufficient')) {
          return res.status(400).json({ error: stageError.message });
        }
        return res.status(400).json({
          error: 'Failed to start M-Pesa payment',
          message: stageError.message,
        });
      }

      const { attempt, cart } = staged;

      try {
        const paymentConfig = await getPaymentConfig(business_id);

        const mpesaResp = await initiateBusinessPayment({
          paymentConfig,
          phone: customer_phone,
          amount: cart.total_amount,
          description: `PAYME payment ${attempt.id}`,
        });

        const checkoutRequestId = mpesaResp.CheckoutRequestID || null;

        if (!checkoutRequestId) {
          throw new Error('M-Pesa did not return a CheckoutRequestID');
        }

        await attachCheckoutRequestId(
          attempt.id,
          checkoutRequestId,
          mpesaResp.MerchantRequestID || null
        );

        response = {
          message: 'M-Pesa payment requested — awaiting customer confirmation',
          // Deliberately no `sale` key: there is no sale yet. Clients must
          // treat this as pending and wait for the callback.
          attempt_id: attempt.id,
          items: cart.items,
          summary: {
            items_count: cart.items_count,
            total_amount: cart.total_amount,
          },
          mpesa: {
            status: 'initiated',
            checkoutRequestId,
            customer_message:
              mpesaResp.CustomerMessage ||
              'Enter MPESA PIN on your phone to complete payment',
            amount: cart.total_amount,
          },
        };

        logger.info(`M-Pesa STK initiated for attempt ${attempt.id}`, {
          checkoutRequestId,
          amount: cart.total_amount,
        });

        return res.status(202).json(response);
      } catch (mpesaError) {
        // The push never reached the customer — release the hold so the
        // stock goes straight back on the shelf.
        await abandonAttempt(attempt.id, mpesaError.message);
        logger.error('Failed to initiate M-Pesa for PayMe', mpesaError);
        return res.status(502).json({
          error: 'Failed to initiate M-Pesa payment',
          message: mpesaError.message,
        });
      }
    } else {
      // ══════════════════════════════════════════
      // CASH / CREDIT / HIRE PURCHASE — goods leave immediately, so the
      // sale (with FIFO stock deduction), the payment-mode-specific
      // record (credit sale / HP agreement), and the token deduction +
      // ledger entry all run as ONE atomic transaction. If ANYTHING
      // fails partway — insufficient stock, credit limit exceeded, or
      // (belt-and-suspenders, since we already checked above) an
      // insufficient token balance — none of it is left half-committed.
      // ══════════════════════════════════════════
      try {
        await db.transaction(async tx => {
          result = await saleService.createSale(
            req.user.id,
            business_id,
            items,
            payment_mode,
            { customer_phone, customer_name, customer_type, note },
            tx
          );

          response = {
            message:
              payment_mode === 'cash'
                ? 'Sale completed successfully'
                : payment_mode === 'credit'
                  ? 'Credit sale recorded'
                  : 'Hire purchase agreement created',
            sale: result.sale,
            items: result.items,
            summary: result.summary,
          };

          if (payment_mode === 'cash') {
            await createRecord({
              business_id,
              user_id: req.user.id,
              type: 'sales',
              category: 'cash',
              amount: result.summary.total_amount,
              payment_method: 'cash',
              transaction_date: new Date(),
              reference_id: String(result.sale.id),
              description: `Cash sale #${result.sale.id}`,
              items: result.items.map(item => ({
                item_name: item.product_name || `Product #${item.product_id}`,
                quantity: Number(item.quantity),
                unit_price: Number(item.unit_price),
                product_id: item.product_id,
                cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
              })),
            }, tx);
          }

          if (payment_mode === 'credit') {
            const risk = await assessCreditStockRisk(
              business_id,
              result.items,
              result.summary.total_amount,
              tx
            );

            if (risk.atRisk && !override_stock_warning) {
              throw new CreditStockRiskWarning(risk);
            }

            await createCreditSale(
              req.user.id,
              business_id,
              credit_account_id,
              result.sale.id,
              result.summary.total_amount,
              credit_due_date,
              result.items,
              tx
            );

            await createRecord({
              business_id,
              user_id: req.user.id,
              type: 'credit',
              category: 'credit_sale',
              amount: result.summary.total_amount,
              payment_method: 'credit',
              transaction_date: new Date(),
              reference_id: String(result.sale.id),
              description: `Credit sale #${result.sale.id}`,
              credit_due_date,
              items: result.items.map(item => ({
                item_name: item.product_name || `Product #${item.product_id}`,
                quantity: Number(item.quantity),
                unit_price: Number(item.unit_price),
                product_id: item.product_id,
                cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
              })),
            }, tx);

            response.credit = {
              status: 'recorded',
              account_id: credit_account_id,
              due_date: credit_due_date,
              amount_due: result.summary.total_amount,
            };
          }

          if (payment_mode === 'hire_purchase') {
            const totalAmount = result.summary.total_amount;

            // Calculate final payment date from frequency + number of installments
            const finalPaymentDate = new Date(hp_first_payment_date);
            if (hp_installment_frequency === 'monthly') {
              finalPaymentDate.setMonth(
                finalPaymentDate.getMonth() + hp_number_of_installments - 1
              );
            } else if (hp_installment_frequency === 'weekly') {
              finalPaymentDate.setDate(
                finalPaymentDate.getDate() + (hp_number_of_installments - 1) * 7
              );
            } else if (hp_installment_frequency === 'bi-weekly') {
              finalPaymentDate.setDate(
                finalPaymentDate.getDate() + (hp_number_of_installments - 1) * 14
              );
            } else if (hp_installment_frequency === 'daily') {
              finalPaymentDate.setDate(
                finalPaymentDate.getDate() + hp_number_of_installments - 1
              );
            }

            const agreement = await createAgreement({
              saleId: result.sale.id,
              accountId: hp_account_id,
              businessId: business_id,
              principalAmount: totalAmount,
              interestRate: hp_interest_rate,
              downPayment: hp_down_payment,
              installmentAmount: hp_installment_amount,
              installmentFrequency: hp_installment_frequency,
              numberOfInstallments: hp_number_of_installments,
              agreementDate: new Date(),
              firstPaymentDate: hp_first_payment_date,
              finalPaymentDate,
              lateFeeAmount: 0,
              gracePeriodDays: 3,
              createdBy: req.user.id,
            }, tx);

            await createRecord({
              business_id,
              user_id: req.user.id,
              type: 'hp',
              category: 'hire_purchase',
              amount: totalAmount,
              payment_method: 'hire_purchase',
              transaction_date: new Date(),
              reference_id: String(result.sale.id),
              description: `HP sale #${result.sale.id} — ${hp_number_of_installments} installments`,
              items: result.items.map(item => ({
                item_name: item.product_name || `Product #${item.product_id}`,
                quantity: Number(item.quantity),
                unit_price: Number(item.unit_price),
                product_id: item.product_id,
                cost_per_unit: item.unit_cost ? Number(item.unit_cost) : null,
              })),
            }, tx);

            response.hire_purchase = {
              status: 'agreement_created',
              agreement_id: agreement.agreement?.id,
              installments: hp_number_of_installments,
              installment_amount: hp_installment_amount,
              frequency: hp_installment_frequency,
              first_payment_date: hp_first_payment_date,
            };
          }
        });
      } catch (txError) {
        if (txError instanceof CreditStockRiskWarning) {
          return res.status(409).json({
            warning: true,
            code: 'CREDIT_STOCK_RISK',
            message: buildRiskMessage(txError.risk),
            details: txError.risk,
            requires_confirmation: true,
          });
        }
        if (txError.message && txError.message.includes('Insufficient tokens')) {
          return res.status(402).json({
            error: 'Insufficient token balance',
            message: 'Token balance is 0. Please top up your wallet to continue selling.',
            code: 'INSUFFICIENT_TOKENS',
          });
        }
        if (txError.message && txError.message.includes('Insufficient stock')) {
          return res.status(400).json({ error: txError.message });
        }
        if (txError.message && txError.message.includes('Credit limit exceeded')) {
          return res.status(400).json({ error: txError.message });
        }
        if (
          payment_mode === 'credit' &&
          txError.message &&
          (txError.message.includes('Credit account') ||
            txError.message.includes('credit_account_id') ||
            txError.message.includes('credit_due_date'))
        ) {
          return res.status(400).json({
            error: 'Credit sale failed',
            message: txError.message,
          });
        }
        logger.error(`${payment_mode} PayMe transaction failed`, txError);
        return res.status(400).json({
          error:
            payment_mode === 'cash'
              ? 'Cash sale failed'
              : payment_mode === 'credit'
                ? 'Credit sale failed'
                : 'Hire purchase failed',
          message: txError.message,
        });
      }
    }

    logger.info(
      `PayMe processed: ${payment_mode} sale #${result.sale.id} — business ${business_id}, total: ${result.summary.total_amount}`
    );

    res.status(201).json(response);
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    if (e.message.includes('Product') && e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }
    if (e.message.includes('Insufficient stock')) {
      return res.status(400).json({ error: e.message });
    }
    logger.error('Error processing PayMe', e);
    next(e);
  }
};

// ─────────────────────────────────────────────
// GET M-PESA ATTEMPT STATUS
// GET /api/payme/mpesa/attempts/:id
//
// What clients poll after an STK push. Under the old flow they polled
// GET /api/payme/sales/:id, because a (pending) sale row already existed
// at push time — it doesn't any more, and that's deliberate. This is the
// replacement: it reports the attempt's own status, and hands back the
// sale id once the callback has actually created one.
//
//   initiated → still waiting on the customer's PIN
//   success   → paid; `sale_id` is populated
//   failed    → cancelled/declined; no sale exists and none will
//   timeout   → no callback arrived; hold released, no sale exists
// ─────────────────────────────────────────────

export const getMpesaAttemptStatus = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const attemptId = Number(req.params.id);
    if (Number.isNaN(attemptId) || attemptId <= 0) {
      return res.status(400).json({ error: 'Invalid attempt id' });
    }

    const [attempt] = await db
      .select()
      .from(mpesaAttempts)
      .where(eq(mpesaAttempts.id, attemptId))
      .limit(1);

    if (!attempt) {
      return res.status(404).json({ error: 'Payment attempt not found' });
    }

    // Ownership check — the attempt records who started it.
    if (attempt.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.status(200).json({
      message: 'Payment attempt status retrieved',
      attempt: {
        id: attempt.id,
        status: attempt.status,
        amount: Number(attempt.amount),
        amount_paid: attempt.amount_paid ? Number(attempt.amount_paid) : null,
        phone: attempt.phone,
        checkout_request_id: attempt.checkout_request_id,
        mpesa_receipt: attempt.mpesa_receipt,
        result_code: attempt.result_code,
        result_desc: attempt.result_desc,
        sale_id: attempt.sale_id,
        created_at: attempt.created_at,
        completed_at: attempt.completed_at,
      },
    });
  } catch (e) {
    logger.error('Error getting M-Pesa attempt status', e);
    next(e);
  }
};

function buildRiskMessage(risk) {
  const parts = [];
  if (risk.businessWideRisk) {
    parts.push(
      `Unpaid credit would reach KES ${risk.totalUnpaidCredit.toFixed(0)}, over ${risk.thresholdPercent}% of your KES ${risk.inventoryValue.toFixed(0)} stock value.`
    );
  }
  if (risk.lowStockItems.length > 0) {
    const names = risk.lowStockItems
      .map(item => `${item.name} (${item.remaining} left)`)
      .join(', ');
    parts.push(`Low stock on: ${names}.`);
  }
  return parts.join(' ');
}

// ─────────────────────────────────────────────
// GET SALES AS LINE ITEMS
// GET /api/payme/sales/business/:businessId/items
// One row per product per sale — feeds the Daily Sales table directly.
// ─────────────────────────────────────────────

export const getSalesItemsHistory = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const result = await saleService.getSaleItemsForBusiness(req.user.id, businessId, {
      limit,
      offset,
    });

    res.status(200).json({
      message: 'Sale line items retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error getting sales line items', e);
    next(e);
  }
};

// ─────────────────────────────────────────────
// GET SALES HISTORY
// GET /api/payme/sales/business/:businessId
// ─────────────────────────────────────────────

export const getSalesHistory = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const result = await saleService.getSalesForBusiness(req.user.id, businessId, {
      limit,
    });

    res.status(200).json({
      message: 'Sales history retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error getting sales history', e);
    next(e);
  }
};

export const getDailySalesLedgerHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    // Midnight-to-midnight in Nairobi. This was written out by hand here; it
    // now shares utils/businessDay.js with the statement preview and the PDF,
    // so a "day" can't quietly mean two different things across the app.
    const { dayKey, dayStart, dayEnd } = businessDayRange(req.query.date);

    if (Number.isNaN(dayStart.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    const result = await saleService.getStatementFinancials(businessId, dayStart, dayEnd);

    res.status(200).json({
      message: 'Daily sales ledger retrieved successfully',
      businessId,
      date: dayKey,
      ...result,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error getting daily sales ledger', e);
    next(e);
  }
};

// ─────────────────────────────────────────────
// GET SINGLE SALE DETAILS
// GET /api/payme/sales/:id
// ─────────────────────────────────────────────

export const getSaleDetails = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const saleId = Number(req.params.id);
    if (Number.isNaN(saleId) || saleId <= 0) {
      return res.status(400).json({ error: 'Invalid sale id' });
    }

    const result = await saleService.getSaleById(req.user.id, saleId);

    res.status(200).json({
      message: 'Sale details retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (
      e.message === 'Sale not found' ||
      e.message === 'Sale not found or access denied'
    ) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    logger.error('Error getting sale details', e);
    next(e);
  }
};