import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  createProductSchema,
  updateProductSchema,
  addStockSchema,
  recordAdjustmentSchema,
} from '#validations/stock.validation.js';
import {
  createProduct,
  getProductsForBusiness,
  getProductById,
  updateProduct,
  addStock,
  getInventoryForProduct,
  getFullInventoryForBusiness,
  recordAdjustment,
} from '#services/stock.service.js';

// ============ PRODUCTS ============

export const createProductHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = createProductSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const product = await createProduct(req.user.id, validationResult.data);

    res.status(201).json({
      message: 'Product created successfully',
      product,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error creating product', e);
    next(e);
  }
};

export const listProductsHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const products = await getProductsForBusiness(req.user.id, businessId);

    res.status(200).json({
      message: 'Products retrieved successfully',
      products,
      count: products.length,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error listing products', e);
    next(e);
  }
};

export const getProductHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const productId = Number(req.params.id);
    if (Number.isNaN(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Invalid product id' });
    }

    const product = await getProductById(req.user.id, productId);

    res.status(200).json({
      message: 'Product retrieved successfully',
      product,
    });
  } catch (e) {
    if (
      e.message === 'Product not found' ||
      e.message === 'Product not found or access denied'
    ) {
      return res.status(404).json({ error: 'Product not found' });
    }
    logger.error('Error getting product', e);
    next(e);
  }
};

export const updateProductHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const productId = Number(req.params.id);
    if (Number.isNaN(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Invalid product id' });
    }

    const validationResult = updateProductSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const product = await updateProduct(
      req.user.id,
      productId,
      validationResult.data
    );

    res.status(200).json({
      message: 'Product updated successfully',
      product,
    });
  } catch (e) {
    if (
      e.message === 'Product not found' ||
      e.message === 'Product not found or access denied'
    ) {
      return res.status(404).json({ error: 'Product not found' });
    }
    logger.error('Error updating product', e);
    next(e);
  }
};

// ============ STOCK BATCHES ============

export const addStockHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = addStockSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await addStock(req.user.id, validationResult.data);

    res.status(201).json({
      message: 'Stock added successfully',
      ...result,
    });
  } catch (e) {
    if (
      e.message === 'Product not found' ||
      e.message === 'Product not found or access denied'
    ) {
      return res.status(404).json({ error: 'Product not found' });
    }
    logger.error('Error adding stock', e);
    next(e);
  }
};

// ============ INVENTORY ============

export const getProductInventoryHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const productId = Number(req.params.id);
    if (Number.isNaN(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Invalid product id' });
    }

    const result = await getInventoryForProduct(req.user.id, productId);

    res.status(200).json({
      message: 'Inventory retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (
      e.message === 'Product not found' ||
      e.message === 'Product not found or access denied'
    ) {
      return res.status(404).json({ error: 'Product not found' });
    }
    logger.error('Error getting product inventory', e);
    next(e);
  }
};

export const getBusinessInventoryHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId) || businessId <= 0) {
      return res.status(400).json({ error: 'Invalid business id' });
    }

    const result = await getFullInventoryForBusiness(req.user.id, businessId);

    res.status(200).json({
      message: 'Business inventory retrieved successfully',
      ...result,
    });
  } catch (e) {
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    logger.error('Error getting business inventory', e);
    next(e);
  }
};

// ============ ADJUSTMENTS ============

export const recordAdjustmentHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = recordAdjustmentSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await recordAdjustment(req.user.id, validationResult.data);

    res.status(200).json({
      message: 'Adjustment recorded successfully',
      ...result,
    });
  } catch (e) {
    if (
      e.message === 'Product not found' ||
      e.message === 'Product not found or access denied'
    ) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (e.message.includes('Insufficient stock')) {
      return res.status(400).json({ error: e.message });
    }
    logger.error('Error recording adjustment', e);
    next(e);
  }
};
