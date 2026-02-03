import logger from '#config/logger.js';
import {
  createCustomer,
  getCustomer,
  listCustomers,
  searchCustomers,
  updateCustomer,
  deleteCustomer,
  addNote,
  getNotes,
  updatePreferences,
  getPurchaseHistory,
  getCustomerMetrics,
  getRepeatCustomers,
} from '#services/customer.service.js';
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerNoteSchema,
  updatePreferencesSchema,
  customerListSchema,
} from '#validations/customer.validation.js';
import { formatValidationError } from '#utils/format.js';

/**
 * POST /api/customers/:businessId/
 * Create a new customer
 */
export async function createCustomerHandler(req, res, next) {
  try {
    const { businessId } = req.params;

    // Validate input
    const validationResult = createCustomerSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    // Create customer
    const customer = await createCustomer(
      parseInt(businessId),
      validationResult.data
    );

    logger.info(`Customer created: ${customer.id}`);
    return res.status(201).json({
      message: 'Customer created successfully',
      customer,
    });
  } catch (e) {
    logger.error('Error creating customer', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Business not found' });
    }
    next(e);
  }
}

/**
 * GET /api/customers/:businessId/:customerId
 * Get a specific customer with all data
 */
export async function getCustomerHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;

    const customer = await getCustomer(
      parseInt(customerId),
      parseInt(businessId)
    );

    return res.status(200).json({
      customer,
    });
  } catch (e) {
    logger.error('Error fetching customer', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    next(e);
  }
}

/**
 * GET /api/customers/:businessId/
 * List customers for a business with filtering
 */
export async function listCustomersHandler(req, res, next) {
  try {
    const { businessId } = req.params;

    // Validate query params
    const validationResult = customerListSchema.safeParse(req.query);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const options = {
      limit: validationResult.data.limit || 20,
      offset: validationResult.data.offset || 0,
      sort_by: validationResult.data.sort_by || 'created_at',
      sort_order: validationResult.data.sort_order || 'desc',
      filter_type: validationResult.data.filter_type,
      is_active: validationResult.data.is_active !== 'false',
    };

    const result = await listCustomers(parseInt(businessId), options);

    return res.status(200).json(result);
  } catch (e) {
    logger.error('Error listing customers', e);
    next(e);
  }
}

/**
 * GET /api/customers/:businessId/search
 * Search customers by name, phone, or email
 */
export async function searchCustomersHandler(req, res, next) {
  try {
    const { businessId } = req.params;
    const { q, limit } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Search query (q) is required',
      });
    }

    const results = await searchCustomers(
      parseInt(businessId),
      q,
      limit ? parseInt(limit) : 10
    );

    return res.status(200).json({
      results,
      query: q,
      count: results.length,
    });
  } catch (e) {
    logger.error('Error searching customers', e);
    next(e);
  }
}

/**
 * PATCH /api/customers/:businessId/:customerId
 * Update customer information
 */
export async function updateCustomerHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;

    // Validate input
    const validationResult = updateCustomerSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const customer = await updateCustomer(
      parseInt(customerId),
      parseInt(businessId),
      validationResult.data
    );

    return res.status(200).json({
      message: 'Customer updated successfully',
      customer,
    });
  } catch (e) {
    logger.error('Error updating customer', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    next(e);
  }
}

/**
 * DELETE /api/customers/:businessId/:customerId
 * Delete (soft delete) a customer
 */
export async function deleteCustomerHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;

    const customer = await deleteCustomer(
      parseInt(customerId),
      parseInt(businessId)
    );

    return res.status(200).json({
      message: 'Customer deleted successfully',
      customer,
    });
  } catch (e) {
    logger.error('Error deleting customer', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    next(e);
  }
}

/**
 * POST /api/customers/:businessId/:customerId/notes
 * Add a note to a customer
 */
export async function addNoteHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;

    // Validate input
    const validationResult = customerNoteSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const note = await addNote(
      parseInt(customerId),
      parseInt(businessId),
      {
        ...validationResult.data,
        created_by: req.user?.id,
      }
    );

    return res.status(201).json({
      message: 'Note added successfully',
      note,
    });
  } catch (e) {
    logger.error('Error adding note', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    next(e);
  }
}

/**
 * GET /api/customers/:businessId/:customerId/notes
 * Get all notes for a customer
 */
export async function getNotesHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;

    const notes = await getNotes(parseInt(customerId), parseInt(businessId));

    return res.status(200).json({
      notes,
      count: notes.length,
    });
  } catch (e) {
    logger.error('Error fetching notes', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    next(e);
  }
}

/**
 * PATCH /api/customers/:businessId/:customerId/preferences
 * Update customer preferences
 */
export async function updatePreferencesHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;

    // Validate input
    const validationResult = updatePreferencesSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const preferences = await updatePreferences(
      parseInt(customerId),
      parseInt(businessId),
      validationResult.data
    );

    return res.status(200).json({
      message: 'Preferences updated successfully',
      preferences,
    });
  } catch (e) {
    logger.error('Error updating preferences', e);
    if (e.message === 'Customer preferences not found') {
      return res.status(404).json({ error: 'Customer preferences not found' });
    }
    next(e);
  }
}

/**
 * GET /api/customers/:businessId/:customerId/history
 * Get purchase history for a customer
 */
export async function getPurchaseHistoryHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;
    const { limit, offset } = req.query;

    const options = {
      limit: limit ? parseInt(limit) : 10,
      offset: offset ? parseInt(offset) : 0,
    };

    const history = await getPurchaseHistory(
      parseInt(customerId),
      parseInt(businessId),
      options
    );

    return res.status(200).json(history);
  } catch (e) {
    logger.error('Error fetching purchase history', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    next(e);
  }
}

/**
 * GET /api/customers/:businessId/:customerId/metrics
 * Get detailed customer metrics
 */
export async function getCustomerMetricsHandler(req, res, next) {
  try {
    const { businessId, customerId } = req.params;

    const metrics = await getCustomerMetrics(
      parseInt(customerId),
      parseInt(businessId)
    );

    return res.status(200).json({
      metrics,
    });
  } catch (e) {
    logger.error('Error fetching customer metrics', e);
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    next(e);
  }
}

/**
 * GET /api/customers/:businessId/repeat
 * Get repeat customers for a business
 */
export async function getRepeatCustomersHandler(req, res, next) {
  try {
    const { businessId } = req.params;
    const { limit, offset, min_purchases } = req.query;

    const options = {
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
      min_purchases: min_purchases ? parseInt(min_purchases) : 2,
    };

    const customers = await getRepeatCustomers(parseInt(businessId), options);

    return res.status(200).json({
      customers,
      count: customers.length,
      filter: {
        min_purchases: options.min_purchases,
      },
    });
  } catch (e) {
    logger.error('Error fetching repeat customers', e);
    next(e);
  }
}
