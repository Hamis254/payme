// routes/credit.routes.js
import { Router } from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { revenueGuard } from '#middleware/revenueGuard.middleware.js';
import { validateRequest } from '#middleware/validation.middleware.js';
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
router.get('/accounts', validateRequest(creditQuerySchema), getCreditAccounts);
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
  validateRequest(creditQuerySchema),
  getCreditSales
);
router.get('/sales/:saleId', getCreditSale);

// Payments
router.post(
  '/payments',
  validateRequest(recordCreditPaymentSchema),
  recordCreditPayment
);
router.get(
  '/accounts/:accountId/payments',
  validateRequest(creditQuerySchema),
  getCreditPayments
);

// Ledger
router.get(
  '/accounts/:accountId/ledger',
  validateRequest(creditQuerySchema),
  getCreditLedger
);

// Reports & Analytics
router.get('/summary', getCreditSummary);
router.get('/reports/aging', getAgingReport);
router.get(
  '/accounts/:accountId/statement',
  validateRequest(creditQuerySchema),
  getCustomerStatement
);

export default router;
