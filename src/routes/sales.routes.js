import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { revenueGuard } from '#middleware/revenueGuard.middleware.js';
import { webhookLimiter } from '#middleware/rateLimiter.middleware.js';
import {
  createSaleHandler,
  getSaleHandler,
  listSalesHandler,
  payCashHandler,
  payMpesaHandler,
  mpesaCallbackHandler,
  cancelSaleHandler,
} from '#controllers/sales.controller.js';

const router = express.Router();

// M-Pesa callback endpoint (public - no auth required)
// Rate limited to prevent abuse
router.post('/mpesa/callback', webhookLimiter, mpesaCallbackHandler);

// All other routes require authentication
router.use(authenticateToken);

// Create a new sale (billable - requires revenue guard)
router.post('/', revenueGuard, createSaleHandler);

// Get sales for business
router.get('/business/:businessId', listSalesHandler);

// Get single sale
router.get('/:id', getSaleHandler);

// Pay for sale with cash
router.post('/:id/pay/cash', payCashHandler);

// Initiate M-Pesa STK Push for sale
router.post('/:id/pay/mpesa', payMpesaHandler);

// Cancel a pending sale
router.post('/:id/cancel', cancelSaleHandler);

export default router;
