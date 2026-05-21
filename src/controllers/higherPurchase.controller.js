import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { and, eq } from 'drizzle-orm';
import { AuthorizationError } from '#middleware/errorHandler.middleware.js';
import {
  createAgreement,
  getAgreementById,
  listAgreements,
  recordInstallmentPayment,
  getOverdueInstallments,
  getUpcomingInstallments,
  getAgreementSummary,
  getStatusDistribution,
  updateAgreementStatus,
  getPaymentHistory,
  getCollectionRate,
} from '#services/higherPurchase.service.js';
import {
  createHirePurchaseSchema,
  recordInstallmentPaymentSchema,
  updateHirePurchaseSchema,
  hirePurchaseQuerySchema,
} from '#validations/higherPurchase.validation.js';
import { formatValidationError } from '#utils/format.js';

async function assertBusinessOwnership(userId, businessId) {
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) {
    throw new AuthorizationError('Business not found or access denied');
  }
}

/**
 * POST /api/hire-purchase/:businessId/create
 * Create a new hire purchase agreement
 */
export async function createAgreementHandler(req, res, next) {
  try {
    const businessId = parseInt(req.params.businessId);
    await assertBusinessOwnership(req.user.id, businessId);

    const validationResult = createHirePurchaseSchema.safeParse({
      ...req.body,
      businessId,
      createdBy: req.user.id,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await createAgreement(validationResult.data);

    logger.info(`Hire purchase agreement created by user ${req.user.id}`, {
      agreementId: result.agreement.id,
      businessId: req.params.businessId,
    });

    return res.status(201).json({
      success: true,
      message: 'Hire purchase agreement created successfully',
      agreement: {
        id: result.agreement.id,
        principal_amount: parseFloat(result.agreement.principal_amount),
        total_amount: parseFloat(result.agreement.total_amount),
        amount_financed: parseFloat(result.agreement.amount_financed),
        installment_frequency: result.agreement.installment_frequency,
        number_of_installments: result.agreement.number_of_installments,
        status: result.agreement.status,
        created_at: result.agreement.created_at,
      },
      installments_count: result.installments.length,
      request_id: req.id,
    });
  } catch (e) {
    logger.error('Error creating agreement:', e);
    next(e);
  }
}

/**
 * GET /api/hire-purchase/:businessId/:agreementId
 * Get a specific agreement with all installments
 */
export async function getAgreementHandler(req, res, next) {
  try {
    const { businessId, agreementId } = req.params;
    await assertBusinessOwnership(req.user.id, parseInt(businessId));

    const agreement = await getAgreementById(parseInt(agreementId));

    if (!agreement || agreement.business_id !== parseInt(businessId)) {
      return res.status(404).json({
        error: 'Agreement not found',
      });
    }

    return res.status(200).json({
      success: true,
      agreement,
    });
  } catch (e) {
    logger.error('Error fetching agreement:', e);
    next(e);
  }
}

/**
 * GET /api/hire-purchase/:businessId
 * List agreements with filters
 */
export async function listAgreementsHandler(req, res, next) {
  try {
    const businessId = parseInt(req.params.businessId);
    await assertBusinessOwnership(req.user.id, businessId);

    const validationResult = hirePurchaseQuerySchema.safeParse({
      businessId,
      ...req.query,
      limit: req.query.limit ? parseInt(req.query.limit) : 50,
      offset: req.query.offset ? parseInt(req.query.offset) : 0,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const agreements = await listAgreements(validationResult.data);

    return res.status(200).json({
      success: true,
      count: agreements.length,
      agreements,
    });
  } catch (e) {
    logger.error('Error listing agreements:', e);
    next(e);
  }
}

/**
 * POST /api/hire-purchase/:businessId/:agreementId/payment
 * Record an installment payment
 */
export async function recordPaymentHandler(req, res, next) {
  try {
    await assertBusinessOwnership(req.user.id, parseInt(req.params.businessId));

    const validationResult = recordInstallmentPaymentSchema.safeParse({
      ...req.body,
      agreementId: parseInt(req.params.agreementId),
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await recordInstallmentPayment(validationResult.data);

    logger.info(`Installment payment recorded by user ${req.user.id}`, {
      installmentId: result.installment.id,
      agreementId: req.params.agreementId,
    });

    return res.status(200).json({
      success: true,
      message: 'Payment recorded successfully',
      installment: {
        id: result.installment.id,
        installment_number: result.installment.installment_number,
        amount_due: parseFloat(result.installment.amount_due),
        amount_paid: parseFloat(result.installment.amount_paid),
        status: result.installment.status,
        payment_date: result.installment.payment_date,
      },
      agreement_balance: parseFloat(result.agreement.balance_remaining),
      request_id: req.id,
    });
  } catch (e) {
    logger.error('Error recording payment:', e);
    next(e);
  }
}

/**
 * GET /api/hire-purchase/:businessId/overdue
 * Get overdue installments
 */
export async function getOverdueHandler(req, res, next) {
  try {
    const { businessId } = req.params;
    await assertBusinessOwnership(req.user.id, parseInt(businessId));

    const overdue = await getOverdueInstallments(parseInt(businessId));

    return res.status(200).json({
      success: true,
      count: overdue.length,
      total_overdue: overdue.reduce((sum, item) => sum + item.amount_due, 0),
      overdue,
    });
  } catch (e) {
    logger.error('Error fetching overdue:', e);
    next(e);
  }
}

/**
 * GET /api/hire-purchase/:businessId/upcoming
 * Get upcoming installments
 */
export async function getUpcomingHandler(req, res, next) {
  try {
    const { businessId } = req.params;
    await assertBusinessOwnership(req.user.id, parseInt(businessId));
    const daysAhead = req.query.daysAhead ? parseInt(req.query.daysAhead) : 30;

    const upcoming = await getUpcomingInstallments(
      parseInt(businessId),
      daysAhead
    );

    return res.status(200).json({
      success: true,
      count: upcoming.length,
      daysAhead,
      upcoming,
    });
  } catch (e) {
    logger.error('Error fetching upcoming:', e);
    next(e);
  }
}

/**
 * GET /api/hire-purchase/:businessId/summary
 * Get agreement summary and statistics
 */
export async function getSummaryHandler(req, res, next) {
  try {
    const { businessId } = req.params;
    await assertBusinessOwnership(req.user.id, parseInt(businessId));

    const summary = await getAgreementSummary(parseInt(businessId));
    const distribution = await getStatusDistribution(parseInt(businessId));
    const collectionRate = await getCollectionRate(parseInt(businessId));

    return res.status(200).json({
      success: true,
      summary,
      distribution,
      collection_rate: parseFloat(collectionRate.toFixed(2)),
    });
  } catch (e) {
    logger.error('Error getting summary:', e);
    next(e);
  }
}

/**
 * GET /api/hire-purchase/:businessId/:agreementId/payment-history
 * Get payment history for an agreement
 */
export async function getPaymentHistoryHandler(req, res, next) {
  try {
    await assertBusinessOwnership(req.user.id, parseInt(req.params.businessId));
    const { agreementId } = req.params;

    const history = await getPaymentHistory(parseInt(agreementId));

    return res.status(200).json({
      success: true,
      count: history.length,
      history,
    });
  } catch (e) {
    logger.error('Error fetching payment history:', e);
    next(e);
  }
}

/**
 * PATCH /api/hire-purchase/:businessId/:agreementId/status
 * Update agreement status
 */
export async function updateStatusHandler(req, res, next) {
  try {
    await assertBusinessOwnership(req.user.id, parseInt(req.params.businessId));
    const validationResult = updateHirePurchaseSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { agreementId } = req.params;
    const { status } = validationResult.data;

    if (!status) {
      return res.status(400).json({
        error: 'Status is required',
      });
    }

    const updated = await updateAgreementStatus(parseInt(agreementId), status);

    logger.info(
      `Agreement ${agreementId} status updated to ${status} by user ${req.user.id}`
    );

    return res.status(200).json({
      success: true,
      message: 'Status updated successfully',
      agreement: {
        id: updated.id,
        status: updated.status,
        updated_at: updated.updated_at,
      },
    });
  } catch (e) {
    logger.error('Error updating status:', e);
    next(e);
  }
}
