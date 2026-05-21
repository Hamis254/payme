import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { validateBusinessId } from '#middleware/businessId.middleware.js';
import {
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
  searchCustomersHandler,
  updateCustomerHandler,
  deleteCustomerHandler,
  addNoteHandler,
  getNotesHandler,
  updatePreferencesHandler,
  getPurchaseHistoryHandler,
  getCustomerMetricsHandler,
  getRepeatCustomersHandler,
} from '#controllers/customer.controller.js';

const router = express.Router();

// All customer routes require authentication
router.use(authenticateToken);

// List and search
router.get('/:businessId', validateBusinessId('params'), listCustomersHandler);
router.get(
  '/:businessId/search',
  validateBusinessId('params'),
  searchCustomersHandler
);
router.get(
  '/:businessId/repeat',
  validateBusinessId('params'),
  getRepeatCustomersHandler
);

// Single customer operations
router.post(
  '/:businessId',
  validateBusinessId('params'),
  createCustomerHandler
);
router.get(
  '/:businessId/:customerId',
  validateBusinessId('params'),
  getCustomerHandler
);
router.patch(
  '/:businessId/:customerId',
  validateBusinessId('params'),
  updateCustomerHandler
);
router.delete(
  '/:businessId/:customerId',
  validateBusinessId('params'),
  deleteCustomerHandler
);

// Customer notes
router.post(
  '/:businessId/:customerId/notes',
  validateBusinessId('params'),
  addNoteHandler
);
router.get(
  '/:businessId/:customerId/notes',
  validateBusinessId('params'),
  getNotesHandler
);

// Customer preferences and metrics
router.patch(
  '/:businessId/:customerId/preferences',
  validateBusinessId('params'),
  updatePreferencesHandler
);
router.get(
  '/:businessId/:customerId/history',
  validateBusinessId('params'),
  getPurchaseHistoryHandler
);
router.get(
  '/:businessId/:customerId/metrics',
  validateBusinessId('params'),
  getCustomerMetricsHandler
);

export default router;
