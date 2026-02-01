import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  previewCart,
  processPayMe,
  getSalesHistory,
  getSaleDetails,
} from '#controllers/payme.controller.js';

const router = express.Router();

router.use(authenticateToken);

// Preview cart (validate items and calculate totals)
router.post('/preview', previewCart);

// Process PayMe (create sale with cash or MPESA)
router.post('/', processPayMe);

// Get sales history for a business
router.get('/sales/business/:businessId', getSalesHistory);

// Get single sale details
router.get('/sales/:id', getSaleDetails);

export default router;
