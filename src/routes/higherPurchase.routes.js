import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  createAgreementHandler,
  getAgreementHandler,
  listAgreementsHandler,
  recordPaymentHandler,
  getOverdueHandler,
  getUpcomingHandler,
  getSummaryHandler,
  getPaymentHistoryHandler,
  updateStatusHandler,
} from '#controllers/higherPurchase.controller.js';

const router = express.Router();

/**
 * POST /api/hire-purchase/:businessId/create
 * Create a new hire purchase agreement
 * @param businessId - Business ID
 * @body {
 *   saleId: number - Sales transaction ID
 *   accountId: number - Credit account ID
 *   principalAmount: number - Original sale amount
 *   interestRate: number - Annual interest rate (%)
 *   downPayment: number - Down payment amount
 *   installmentAmount: number - Per-installment amount
 *   installmentFrequency: string - daily|weekly|bi-weekly|monthly
 *   numberOfInstallments: number - Total number of installments
 *   agreementDate: string - ISO date
 *   firstPaymentDate: string - ISO date
 *   lateFeeAmount?: number - Late payment fee
 *   gracePeriodDays?: number - Grace period before late fee
 *   termsAndConditions?: string - Agreement terms
 *   notes?: string - Additional notes
 * }
 * @example POST /api/hire-purchase/5/create
 * {
 *   "saleId": 42,
 *   "accountId": 10,
 *   "principalAmount": 50000,
 *   "interestRate": 5,
 *   "downPayment": 10000,
 *   "installmentAmount": 1000,
 *   "installmentFrequency": "monthly",
 *   "numberOfInstallments": 48,
 *   "agreementDate": "2026-01-28T00:00:00Z",
 *   "firstPaymentDate": "2026-02-28T00:00:00Z"
 * }
 */
router.post('/:businessId/create', authenticateToken, createAgreementHandler);

/**
 * GET /api/hire-purchase/:businessId/:agreementId
 * Get specific agreement with all installments
 * @param businessId - Business ID
 * @param agreementId - Agreement ID
 * @example GET /api/hire-purchase/5/1
 */
router.get('/:businessId/:agreementId', authenticateToken, getAgreementHandler);

/**
 * GET /api/hire-purchase/:businessId
 * List agreements with optional filters
 * @param businessId - Business ID
 * @query {
 *   status?: string - Filter by status (active|completed|defaulted|cancelled)
 *   startDate?: string - ISO date filter
 *   endDate?: string - ISO date filter
 *   limit?: number - Results per page (default: 50)
 *   offset?: number - Skip N records (default: 0)
 * }
 * @example GET /api/hire-purchase/5?status=active&limit=20
 */
router.get('/:businessId', authenticateToken, listAgreementsHandler);

/**
 * POST /api/hire-purchase/:businessId/:agreementId/payment
 * Record an installment payment
 * @param businessId - Business ID
 * @param agreementId - Agreement ID
 * @body {
 *   installmentId: number - Installment to pay
 *   amountPaid: number - Amount paid
 *   paymentMethod: string - cash|mpesa
 *   mpesaTransactionId?: string - M-Pesa reference
 *   paymentDate?: string - ISO date
 * }
 * @example POST /api/hire-purchase/5/1/payment
 * {
 *   "installmentId": 5,
 *   "amountPaid": 1000,
 *   "paymentMethod": "mpesa",
 *   "mpesaTransactionId": "RQT123456789",
 *   "paymentDate": "2026-02-28T10:30:00Z"
 * }
 */
router.post(
  '/:businessId/:agreementId/payment',
  authenticateToken,
  recordPaymentHandler
);

/**
 * GET /api/hire-purchase/:businessId/overdue
 * Get overdue installments
 * @param businessId - Business ID
 * @example GET /api/hire-purchase/5/overdue
 * @response {
 *   success: true,
 *   count: 3,
 *   total_overdue: 3500,
 *   overdue: [...]
 * }
 */
router.get('/:businessId/overdue', authenticateToken, getOverdueHandler);

/**
 * GET /api/hire-purchase/:businessId/upcoming
 * Get upcoming installments due within N days
 * @param businessId - Business ID
 * @query {
 *   daysAhead?: number - Days to look ahead (default: 30)
 * }
 * @example GET /api/hire-purchase/5/upcoming?daysAhead=7
 */
router.get('/:businessId/upcoming', authenticateToken, getUpcomingHandler);

/**
 * GET /api/hire-purchase/:businessId/summary
 * Get agreement statistics and collection metrics
 * @param businessId - Business ID
 * @example GET /api/hire-purchase/5/summary
 * @response {
 *   success: true,
 *   summary: {
 *     total_agreements: 25,
 *     active_agreements: 15,
 *     completed_agreements: 8,
 *     defaulted_agreements: 2,
 *     total_financed: 500000,
 *     total_remaining: 120000,
 *     total_collected: 380000
 *   },
 *   distribution: { active: {...}, completed: {...} },
 *   collection_rate: 76.0
 * }
 */
router.get('/:businessId/summary', authenticateToken, getSummaryHandler);

/**
 * GET /api/hire-purchase/:businessId/:agreementId/payment-history
 * Get full payment history for an agreement
 * @param businessId - Business ID
 * @param agreementId - Agreement ID
 * @example GET /api/hire-purchase/5/1/payment-history
 */
router.get(
  '/:businessId/:agreementId/payment-history',
  authenticateToken,
  getPaymentHistoryHandler
);

/**
 * PATCH /api/hire-purchase/:businessId/:agreementId/status
 * Update agreement status
 * @param businessId - Business ID
 * @param agreementId - Agreement ID
 * @body {
 *   status: string - active|completed|defaulted|cancelled
 * }
 * @example PATCH /api/hire-purchase/5/1/status
 * {
 *   "status": "completed"
 * }
 */
router.patch(
  '/:businessId/:agreementId/status',
  authenticateToken,
  updateStatusHandler
);

export default router;
