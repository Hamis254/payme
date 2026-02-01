import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  getOrCreateWallet,
  initiateTokenPurchase,
  processTokenPurchaseCallback,
  addTokensManually,
  getWalletBalance,
  getWalletTransactions,
  getTokenPurchaseHistory,
} from '#services/myWallet.service.js';
import {
  initiateTokenPurchaseSchema,
  tokenPurchaseCallbackSchema,
  addTokensManuallySchema,
} from '#validations/wallet.validation.js';

/**
 * Get or create wallet for a user's business
 * GET /api/my-wallet/:businessId
 */
export const getWalletHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { businessId } = req.params;

    if (!businessId) {
      return res.status(400).json({ error: 'Business ID is required' });
    }

    const wallet = await getOrCreateWallet(req.user.id, businessId);

    res.status(200).json({
      success: true,
      message: 'Wallet retrieved',
      wallet,
    });
  } catch (e) {
    logger.error('Get wallet failed', e);
    if (e.message === 'Business not found or access denied') {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * Get wallet balance
 * GET /api/my-wallet/:businessId/balance
 */
export const getBalanceHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { businessId } = req.params;

    if (!businessId) {
      return res.status(400).json({ error: 'Business ID is required' });
    }

    const balance = await getWalletBalance(req.user.id, businessId);

    res.status(200).json({
      success: true,
      balance,
    });
  } catch (e) {
    logger.error('Get balance failed', e);
    if (e.message.includes('Business not found')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next(e);
  }
};

/**
 * Initiate token purchase (M-Pesa STK)
 * POST /api/my-wallet/:businessId/purchase-tokens
 */
export const initiateTokenPurchaseHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { businessId } = req.params;
    const validationResult = initiateTokenPurchaseSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await initiateTokenPurchase(
      req.user.id,
      businessId,
      validationResult.data
    );

    res.status(201).json({
      success: true,
      message: 'Token purchase initiated',
      data: result,
    });
  } catch (e) {
    logger.error('Initiate token purchase failed', e);
    if (e.message.includes('not found') || e.message.includes('access denied')) {
      return res.status(403).json({ error: e.message });
    }
    if (e.message.includes('Invalid')) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * Process M-Pesa callback for token purchase
 * POST /api/my-wallet/callback
 */
export const processCallbackHandler = async (req, res, _next) => {
  try {
    const validationResult = tokenPurchaseCallbackSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid callback',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await processTokenPurchaseCallback(validationResult.data);

    res.status(200).json({
      success: true,
      message: 'Callback processed',
      data: result,
    });
  } catch (e) {
    logger.error('Process callback failed', e);
    res.status(400).json({ error: e.message });
  }
};

/**
 * Get wallet transaction history
 * GET /api/my-wallet/:businessId/transactions
 */
export const getTransactionsHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { businessId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const transactions = await getWalletTransactions(
      req.user.id,
      businessId,
      parseInt(limit),
      parseInt(offset)
    );

    res.status(200).json({
      success: true,
      data: transactions,
    });
  } catch (e) {
    logger.error('Get transactions failed', e);
    if (e.message.includes('access denied')) {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * Get token purchase history
 * GET /api/my-wallet/:businessId/purchase-history
 */
export const getPurchaseHistoryHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { businessId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const history = await getTokenPurchaseHistory(
      req.user.id,
      businessId,
      parseInt(limit),
      parseInt(offset)
    );

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (e) {
    logger.error('Get purchase history failed', e);
    if (e.message.includes('access denied')) {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

/**
 * Add tokens manually (admin only)
 * POST /api/my-wallet/:businessId/add-tokens
 */
export const addTokensHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { businessId } = req.params;
    const validationResult = addTokensManuallySchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const result = await addTokensManually(
      businessId,
      validationResult.data,
      req.user.id
    );

    res.status(201).json({
      success: true,
      message: 'Tokens added',
      data: result,
    });
  } catch (e) {
    logger.error('Add tokens failed', e);
    if (e.message.includes('not found')) {
      return res.status(404).json({ error: e.message });
    }
    if (e.message.includes('Invalid')) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
};
