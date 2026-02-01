import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  createProductHandler,
  listProductsHandler,
  getProductHandler,
  updateProductHandler,
  addStockHandler,
  getProductInventoryHandler,
  getBusinessInventoryHandler,
  recordAdjustmentHandler,
} from '#controllers/stock.controller.js';

const router = express.Router();

router.use(authenticateToken);

// ============ PRODUCTS ============
// Create a new product
router.post('/products', createProductHandler);

// List products for a business
router.get('/products/business/:businessId', listProductsHandler);

// Get product by ID
router.get('/products/:id', getProductHandler);

// Update product
router.put('/products/:id', updateProductHandler);

// ============ STOCK MANAGEMENT ============
// Add stock (restock)
router.post('/stock/add', addStockHandler);

// ============ INVENTORY ============
// Get inventory for a single product
router.get('/inventory/product/:id', getProductInventoryHandler);

// Get full inventory for a business
router.get('/inventory/business/:businessId', getBusinessInventoryHandler);

// ============ ADJUSTMENTS ============
// Record adjustment
router.post('/adjustment', recordAdjustmentHandler);

export default router;
