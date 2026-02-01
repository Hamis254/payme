import logger from '#config/logger.js';
import { formatValidationError } from '#utils/format.js';
import {
  initiateTokenPurchaseSchema,
  addTokensManuallySchema,
  tokenPurchaseCallbackSchema,
  tokenPackages,
} from '#validations/wallet.validation.js';
import {
  getOrCreateWallet,
  initiateTokenPurchase,
  processTokenPurchaseCallback,
  addTokensManually,
  getWalletTransactions as getTransactionsService,
  getTokenPurchaseHistory,
} from '#services/wallet.service.js';

// ============ GET WALLET BALANCE ============

export const getWalletBalance = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId)) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }

    const wallet = await getOrCreateWallet(req.user.id, businessId);

    logger.info(`Wallet balance retrieved for business ${businessId}`);

    res.json({
      message: 'Wallet balance retrieved successfully',
      wallet: {
        businessId: wallet.business_id,
        balanceTokens: wallet.balance_tokens,
        createdAt: wallet.created_at,
        updatedAt: wallet.updated_at,
      },
      tokenValue: {
        tokens: wallet.balance_tokens,
        estimatedValueKES: wallet.balance_tokens * 2, // 1 token = 2 KES
      },
    });
  } catch (e) {
    logger.error('Error getting wallet balance', e);
    if (
      e.message.includes('not found') ||
      e.message.includes('access denied')
    ) {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

// ============ INITIATE TOKEN PURCHASE (M-PESA) ============

export const initiateTokenPurchaseHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validationResult = initiateTokenPurchaseSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { businessId, packageType, phone } = validationResult.data;

    const result = await initiateTokenPurchase(
      req.user.id,
      businessId,
      packageType,
      phone
    );

    logger.info(
      `Token purchase initiated: ${packageType} package for business ${businessId}`
    );

    res.status(201).json({
      message:
        'Token purchase initiated. Please complete payment on your phone.',
      purchase: {
        purchaseId: result.purchaseId,
        packageType,
        tokens: result.tokens,
        amount: result.amount,
        currentBalance: result.currentBalance,
      },
      mpesa: {
        checkoutRequestId: result.checkoutRequestId,
        status: 'pending',
        instruction: 'Check your phone for M-Pesa payment prompt',
      },
    });
  } catch (e) {
    logger.error('Error initiating token purchase', e);
    if (
      e.message.includes('not found') ||
      e.message.includes('access denied')
    ) {
      return res.status(403).json({ error: e.message });
    }
    if (
      e.message.includes('configuration') ||
      e.message.includes('credentials')
    ) {
      return res.status(500).json({
        error: 'Payment system temporarily unavailable',
        details: 'Please contact support if this persists',
      });
    }
    next(e);
  }
};

// ============ M-PESA CALLBACK (TOKEN PURCHASE) ============

export const tokenPurchaseCallbackHandler = async (req, res) => {
  try {
    const validationResult = tokenPurchaseCallbackSchema.safeParse(req.body);
    if (!validationResult.success) {
      logger.warn(
        'Invalid token purchase callback payload',
        validationResult.error
      );
      return res
        .status(200)
        .json({ ResultCode: 1, ResultDesc: 'Invalid payload' });
    }

    const callbackData = req.body.Body.stkCallback;
    const result = await processTokenPurchaseCallback(callbackData);

    logger.info(`Token purchase callback processed: ${result.status}`, {
      purchaseId: result.purchaseId,
    });

    // Always return 200 to M-Pesa to acknowledge receipt
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback processed successfully',
    });
  } catch (e) {
    logger.error('Token purchase callback error', e);
    // Still return 200 to prevent M-Pesa retries
    return res.status(200).json({
      ResultCode: 1,
      ResultDesc: 'Processing error',
    });
  }
};

// ============ ADD TOKENS MANUALLY (ADMIN/CASH) ============

export const addTokensManuallyHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if user has admin role for manual token addition
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Only admins can manually add tokens',
      });
    }

    const validationResult = addTokensManuallySchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { businessId, tokens, note, paymentMethod } = validationResult.data;

    const result = await addTokensManually(
      req.user.id,
      businessId,
      tokens,
      note,
      paymentMethod
    );

    logger.info(
      `Tokens added manually: ${tokens} tokens for business ${businessId} by admin ${req.user.id}`
    );

    res.status(201).json({
      message: 'Tokens added successfully',
      wallet: {
        businessId,
        tokensAdded: tokens,
        newBalance: result.newBalance,
        paymentMethod,
      },
      transaction: {
        amount: tokens * 2, // Retail price
        note,
      },
    });
  } catch (e) {
    logger.error('Error adding tokens manually', e);
    if (
      e.message.includes('not found') ||
      e.message.includes('access denied')
    ) {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

// ============ GET WALLET TRANSACTIONS ============

export const getWalletTransactionsHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId)) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }

    const { type = 'all', limit = 50, offset = 0 } = req.query;

    const result = await getTransactionsService(req.user.id, businessId, {
      type: type !== 'all' ? type : undefined,
      limit: Number(limit),
      offset: Number(offset),
    });

    logger.info(`Wallet transactions retrieved for business ${businessId}`);

    res.json({
      message: 'Transactions retrieved successfully',
      transactions: result.transactions,
      pagination: {
        count: result.transactions.length,
        offset: Number(offset),
        limit: Number(limit),
        hasMore: result.transactions.length === Number(limit),
      },
    });
  } catch (e) {
    logger.error('Error getting wallet transactions', e);
    if (
      e.message.includes('not found') ||
      e.message.includes('access denied')
    ) {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

// ============ GET TOKEN PURCHASE HISTORY ============

export const getTokenPurchasesHandler = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (Number.isNaN(businessId)) {
      return res.status(400).json({ error: 'Invalid business ID' });
    }

    const { status = 'all', limit = 20 } = req.query;

    const result = await getTokenPurchaseHistory(req.user.id, businessId, {
      status: status !== 'all' ? status : undefined,
      limit: Number(limit),
    });

    logger.info(`Token purchase history retrieved for business ${businessId}`);

    res.json({
      message: 'Purchase history retrieved successfully',
      purchases: result.purchases,
      summary: {
        totalPurchases: result.purchases.length,
        totalTokensPurchased: result.purchases.reduce(
          (sum, p) => sum + (p.status === 'success' ? p.tokens_purchased : 0),
          0
        ),
        totalAmountPaid: result.purchases.reduce(
          (sum, p) =>
            sum + (p.status === 'success' ? Number(p.amount_paid) : 0),
          0
        ),
      },
    });
  } catch (e) {
    logger.error('Error getting token purchase history', e);
    if (
      e.message.includes('not found') ||
      e.message.includes('access denied')
    ) {
      return res.status(403).json({ error: e.message });
    }
    next(e);
  }
};

// ============ GET TOKEN PACKAGES INFO ============

export const getTokenPackagesHandler = async (req, res) => {
  try {
    const packages = Object.entries(tokenPackages).map(([key, value]) => ({
      packageType: key,
      tokens: value.tokens,
      price: value.price,
      pricePerToken: (value.price / value.tokens).toFixed(2),
      savings: value.tokens * 2 - value.price, // vs retail price
      savingsPercent: (
        ((value.tokens * 2 - value.price) / (value.tokens * 2)) *
        100
      ).toFixed(1),
    }));

    res.json({
      message: 'Token packages retrieved successfully',
      packages,
      retailPrice: {
        perToken: 2,
        currency: 'KES',
      },
    });
  } catch (e) {
    logger.error('Error getting token packages', e);
    res.status(500).json({ error: 'Failed to retrieve packages' });
  }
};
