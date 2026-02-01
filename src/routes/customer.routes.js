import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
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
router.get('/:businessId/', listCustomersHandler);
router.get('/:businessId/search', searchCustomersHandler);
router.get('/:businessId/repeat', getRepeatCustomersHandler);

// Single customer operations
router.post('/:businessId/', createCustomerHandler);
router.get('/:businessId/:customerId', getCustomerHandler);
router.patch('/:businessId/:customerId', updateCustomerHandler);
router.delete('/:businessId/:customerId', deleteCustomerHandler);

// Customer notes
router.post('/:businessId/:customerId/notes', addNoteHandler);
router.get('/:businessId/:customerId/notes', getNotesHandler);

// Customer preferences and metrics
router.patch('/:businessId/:customerId/preferences', updatePreferencesHandler);
router.get('/:businessId/:customerId/history', getPurchaseHistoryHandler);
router.get('/:businessId/:customerId/metrics', getCustomerMetricsHandler);

export default router;
