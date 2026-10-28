import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  branchApprovalSchema,
  createBusinessSchema,
  SERVER_MANAGED_KEYS,
  updateBusinessSchema,
  validatePaymentDetails,
} from '#validations/businesses.validation.js';
import {
  approveBranchForUser,
  BusinessError,
  resendBranchApprovalForUser,
  createBranchForUser,
  createBusinessForUser,
  getBusinessesForUser,
  getBusinessByIdForUser,
  getBranchesForMainBusinessOwner,
  updateBusinessForUser,
} from '#services/businesses.service.js';

const sendBusinessError = (res, e) =>
  res.status(e.statusCode).json({ error: e.message, code: e.code });

export const createBusiness = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Checked on the raw body: zod would strip these silently, and a client
    // that sends a code should be told it was refused, not ignored.
    const sent = SERVER_MANAGED_KEYS.filter(key => key in (req.body ?? {}));
    if (sent.length > 0) {
      return res.status(400).json({
        error: `${sent.join(', ')} ${sent.length > 1 ? 'are' : 'is'} assigned by the server`,
      });
    }

    const validationResult = createBusinessSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const data = validationResult.data;

    try {
      validatePaymentDetails({
        payment_method: data.payment_method,
        payment_identifier: data.payment_identifier,
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    if (data.branch_type === 'branch') {
      const { business, otp_sent } = await createBranchForUser(req.user.id, data);

      logger.info(`Branch ${business.business_code} requested by user ${req.user.email}`);

      const pending = business.branch_status === 'pending_approval';
      return res.status(201).json({
        message: pending
          ? 'Branch requested. Enter the code sent to the main business owner to activate it.'
          : 'Branch created successfully',
        business,
        otp_sent,
      });
    }

    const business = await createBusinessForUser(req.user.id, data);

    logger.info(`Business ${business.business_code} created for user ${req.user.email}`);
    res.status(201).json({
      message: 'Business created successfully',
      business,
    });
  } catch (e) {
    if (e instanceof BusinessError) return sendBusinessError(res, e);
    logger.error('Error creating business', e);
    next(e);
  }
};

export const listMyBusinesses = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businesses = await getBusinessesForUser(req.user.id);

    res.status(200).json({
      message: 'Businesses retrieved successfully',
      businesses,
      count: businesses.length,
    });
  } catch (e) {
    logger.error('Error listing businesses', e);
    next(e);
  }
};

export const getMyBusinessById = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.id);

    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const business = await getBusinessByIdForUser(req.user.id, businessId);

    res.status(200).json({
      message: 'Business retrieved successfully',
      business,
    });
  } catch (e) {
    if (e.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }

    logger.error('Error getting business', e);
    next(e);
  }
};

export const getMyBusinessBranches = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.id);
    if (!Number.isSafeInteger(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const branches = await getBranchesForMainBusinessOwner(
      req.user.id,
      businessId
    );

    res.status(200).json({
      message: 'Branches retrieved successfully',
      branches,
      count: branches.length,
    });
  } catch (e) {
    if (e instanceof BusinessError) return sendBusinessError(res, e);
    logger.error('Error listing business branches', e);
    next(e);
  }
};

export const updateMyBusiness = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.id);

    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const validationResult = updateBusinessSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const updates = validationResult.data;

    try {
      if (updates.payment_method || updates.payment_identifier) {
        validatePaymentDetails({
          payment_method: updates.payment_method,
          payment_identifier: updates.payment_identifier,
        });
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const business = await updateBusinessForUser(
      req.user.id,
      businessId,
      updates
    );

    res.status(200).json({
      message: 'Business updated successfully',
      business,
    });
  } catch (e) {
    if (e.message === 'Business not found') {
      return res.status(404).json({ error: 'Business not found' });
    }

    logger.error('Error updating business', e);
    next(e);
  }
};

export const resendBranchApproval = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.id);

    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const { business, otp_sent } = await resendBranchApprovalForUser(
      req.user.id,
      businessId
    );

    res.status(200).json({
      message: otp_sent
        ? 'A new code was sent to the main business owner'
        : 'A new code was created, but the SMS could not be sent. Try again shortly.',
      business,
      otp_sent,
    });
  } catch (e) {
    if (e instanceof BusinessError) return sendBusinessError(res, e);
    logger.error('Error resending branch approval code', e);
    next(e);
  }
};

export const approveBranch = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.id);

    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const validationResult = branchApprovalSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const business = await approveBranchForUser(
      req.user.id,
      businessId,
      validationResult.data.otp
    );

    res.status(200).json({
      message: 'Branch approved and active',
      business,
    });
  } catch (e) {
    if (e instanceof BusinessError) return sendBusinessError(res, e);
    logger.error('Error approving branch', e);
    next(e);
  }
};
