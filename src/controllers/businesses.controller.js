import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  createBusinessSchema,
  updateBusinessSchema,
  validatePaymentDetails,
} from '#validations/businesses.validation.js';
import {
  createBusinessForUser,
  getBusinessesForUser,
  getBusinessByIdForUser,
  updateBusinessForUser,
} from '#services/businesses.service.js';

export const createBusiness = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
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

    const business = await createBusinessForUser(req.user.id, data);

    logger.info(`Business created for user ${req.user.email}`);
    res.status(201).json({
      message: 'Business created successfully',
      business,
    });
  } catch (e) {
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

    const business = await updateBusinessForUser(req.user.id, businessId, updates);

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
