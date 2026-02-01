// reconciliation.controller.js
import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  createCashReconciliationSchema,
  createMpesaReconciliationSchema,
  reconciliationConfigSchema,
  listReconciliationsSchema,
} from '#validations/reconciliation.validation.js';
import {
  getReconciliationConfig,
  updateReconciliationConfig,
  createCashReconciliation,
  getCashReconciliations,
  approveCashReconciliation,
  flagCashReconciliation,
  createMpesaReconciliation,
  getMpesaReconciliations,
  getReconciliationSummary,
} from '#services/reconciliation.service.js';
import { db } from '#config/database.js';
import { businesses } from '#models/setting.model.js';
import { and, eq } from 'drizzle-orm';

/**
 * Verify user owns this business
 */
async function verifyBusinessOwnership(businessId, userId) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
    .limit(1);

  if (!business) {
    throw new Error('Business not found or access denied');
  }

  return business;
}

/**
 * GET /api/reconciliation/:businessId/config
 * Get reconciliation configuration
 */
export const getConfigHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const config = await getReconciliationConfig(parseInt(businessId));

    return res.status(200).json({
      success: true,
      config,
    });
  } catch (e) {
    logger.error('Error getting reconciliation config', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * PATCH /api/reconciliation/:businessId/config
 * Update reconciliation configuration
 */
export const updateConfigHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const validationResult = reconciliationConfigSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const config = await updateReconciliationConfig(
      parseInt(businessId),
      validationResult.data
    );

    logger.info(`Reconciliation config updated for business ${businessId}`);

    return res.status(200).json({
      success: true,
      message: 'Configuration updated',
      config,
    });
  } catch (e) {
    logger.error('Error updating reconciliation config', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * POST /api/reconciliation/:businessId/cash
 * Create cash reconciliation
 */
export const createCashReconciliationHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const validationResult = createCashReconciliationSchema.safeParse({
      ...req.body,
      businessId: parseInt(businessId),
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await createCashReconciliation(
      parseInt(businessId),
      req.user.id,
      validationResult.data
    );

    logger.info(`Cash reconciliation created for business ${businessId}`);

    return res.status(201).json({
      success: true,
      message: 'Cash reconciliation created',
      reconciliation: {
        id: result.id,
        reconciliation_date: result.reconciliation_date,
        counted_cash: result.counted_cash,
        system_cash: result.system_cash,
        variance: result.variance,
        variance_percent: result.variance_percent,
        variance_status: result.variance_status,
      },
      systemCashBreakdown: result.systemCashBreakdown,
    });
  } catch (e) {
    logger.error('Error creating cash reconciliation', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * GET /api/reconciliation/:businessId/cash
 * List cash reconciliations
 */
export const listCashReconciliationsHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const validationResult = listReconciliationsSchema.safeParse(req.query);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const reconciliations = await getCashReconciliations(parseInt(businessId), {
      limit: validationResult.data.limit,
      offset: validationResult.data.offset,
      startDate: validationResult.data.startDate,
      endDate: validationResult.data.endDate,
    });

    return res.status(200).json({
      success: true,
      count: reconciliations.length,
      reconciliations,
    });
  } catch (e) {
    logger.error('Error listing cash reconciliations', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * POST /api/reconciliation/:businessId/cash/:id/approve
 * Approve a cash reconciliation
 */
export const approveCashReconciliationHandler = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const reconciliation = await approveCashReconciliation(
      parseInt(businessId),
      parseInt(id),
      req.user.id
    );

    logger.info(`Cash reconciliation ${id} approved by user ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: 'Reconciliation approved',
      reconciliation,
    });
  } catch (e) {
    logger.error('Error approving cash reconciliation', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    if (e.message === 'Reconciliation not found') {
      return res.status(404).json({ error: e.message });
    }
    if (e.message === 'Reconciliation already approved') {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * POST /api/reconciliation/:businessId/cash/:id/flag
 * Flag a cash reconciliation for investigation
 */
export const flagCashReconciliationHandler = async (req, res, next) => {
  try {
    const { businessId, id } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { note } = req.body;

    if (!note) {
      return res.status(400).json({ error: 'Note is required when flagging' });
    }

    const reconciliation = await flagCashReconciliation(
      parseInt(businessId),
      parseInt(id),
      note
    );

    logger.info(`Cash reconciliation ${id} flagged by user ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: 'Reconciliation flagged for investigation',
      reconciliation,
    });
  } catch (e) {
    logger.error('Error flagging cash reconciliation', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * POST /api/reconciliation/:businessId/mpesa
 * Create M-Pesa reconciliation
 */
export const createMpesaReconciliationHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const validationResult = createMpesaReconciliationSchema.safeParse({
      ...req.body,
      businessId: parseInt(businessId),
    });

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await createMpesaReconciliation(
      parseInt(businessId),
      req.user.id,
      validationResult.data
    );

    logger.info(`M-Pesa reconciliation created for business ${businessId}`);

    return res.status(201).json({
      success: true,
      message: 'M-Pesa reconciliation created',
      reconciliation: {
        id: result.id,
        period_start: result.period_start,
        period_end: result.period_end,
        system_amount: result.system_amount,
        bank_amount: result.bank_amount,
        variance_amount: result.variance_amount,
        status: result.status,
      },
      systemBreakdown: result.systemBreakdown,
    });
  } catch (e) {
    logger.error('Error creating M-Pesa reconciliation', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * GET /api/reconciliation/:businessId/mpesa
 * List M-Pesa reconciliations
 */
export const listMpesaReconciliationsHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const { limit = 30, offset = 0 } = req.query;

    const reconciliations = await getMpesaReconciliations(parseInt(businessId), {
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return res.status(200).json({
      success: true,
      count: reconciliations.length,
      reconciliations,
    });
  } catch (e) {
    logger.error('Error listing M-Pesa reconciliations', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * GET /api/reconciliation/:businessId/summary
 * Get reconciliation summary for dashboard
 */
export const getSummaryHandler = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    await verifyBusinessOwnership(parseInt(businessId), req.user.id);

    const summary = await getReconciliationSummary(parseInt(businessId));

    return res.status(200).json({
      success: true,
      summary,
    });
  } catch (e) {
    logger.error('Error getting reconciliation summary', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};
