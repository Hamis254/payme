import { Router } from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { revenueGuard } from '#middleware/revenueGuard.middleware.js';
import { validateRequest } from '#middleware/validation.middleware.js';
import { idempotencyMiddleware } from '#middleware/idempotency.middleware.js';
import { validateCreditPaymentAccount } from '#middleware/creditPayment.middleware.js';
import {
  createCreditAccount,
  getCreditAccounts,
  getCreditAccount,
  updateCreditAccount,
  deactivateCreditAccount,
  createCreditSale,
  getCreditSales,
  getCreditSale,
  recordCreditPayment,
  getCreditPayments,
  getCreditLedger,
  getCreditSummary,
  getAgingReport,
  getCustomerStatement,
  getCreditSalesHistory,
} from '#controllers/credit.controller.js';
import {
  createCreditAccountSchema,
  updateCreditAccountSchema,
  createCreditSaleSchema,
  recordCreditPaymentSchema,
  creditQuerySchema,
} from '#validations/credit.validation.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Account management (billable - requires revenue guard)
router.post(
  '/accounts',
  revenueGuard,
  validateRequest(createCreditAccountSchema),
  createCreditAccount
);
router.get(
  '/accounts',
  validateRequest(creditQuerySchema, 'query'),
  getCreditAccounts
);
router.get('/accounts/:accountId', getCreditAccount);
router.patch(
  '/accounts/:accountId',
  validateRequest(updateCreditAccountSchema),
  updateCreditAccount
);
router.delete('/accounts/:accountId', deactivateCreditAccount);

// Sales (billable - requires revenue guard)
router.post(
  '/sales',
  revenueGuard,
  validateRequest(createCreditSaleSchema),
  createCreditSale
);
router.get(
  '/accounts/:accountId/sales',
  validateRequest(creditQuerySchema, 'query'),
  getCreditSales
);
router.get('/sales/business/:businessId', getCreditSalesHistory);
router.get('/sales/:saleId', getCreditSale);

// Payments
//
// Idempotency-keyed for the same reason POST /api/payme/ is: this is a money
// mutation that a cashier can double-tap on a slow connection, and the app
// retries on timeout. Without a key, a retried "pay KES 500" posts twice and
// books 1,000 against the account — and because the cost-recovery split is
// derived from the pre-payment outstanding, the second one also corrupts the
// profit figure, not just the balance.
//
// The key is required rather than optional: the Flutter client is the only
// caller (verified — nothing in offlineSync posts here), and a silently
// unkeyed payment is exactly the case this is meant to stop. Duplicate
// in-flight requests collide on the idempotency_key UNIQUE constraint and get
// 409; a completed one replays its original response.
router.post(
  '/payments',
  idempotencyMiddleware({ requireIdempotencyKey: true }),
  validateCreditPaymentAccount,
  revenueGuard,
  validateRequest(recordCreditPaymentSchema),
  recordCreditPayment
);
router.get(
  '/accounts/:accountId/payments',
  validateRequest(creditQuerySchema, 'query'),
  getCreditPayments
);

// Ledger
router.get(
  '/accounts/:accountId/ledger',
  validateRequest(creditQuerySchema, 'query'),
  getCreditLedger
);

// Reports & Analytics
router.get('/summary', getCreditSummary);
router.get('/reports/aging', getAgingReport);
router.get(
  '/accounts/:accountId/statement',
  validateRequest(creditQuerySchema, 'query'),
  getCustomerStatement
);

export default router;