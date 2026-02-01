import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and } from 'drizzle-orm';
import {
  wallets,
  walletTransactions,
  walletPayments,
} from '#models/myWallet.model.js';
import { businesses } from '#models/setting.model.js';
import { sales } from '#models/sales.model.js';

/**
 * Wallet Payment Controller
 * Handles payment transactions using wallet credit for sales
 * Wallet uses fixed paybill: 650880 and account: 37605544
 */

// Wallet Configuration
const WALLET_PAYBILL = '650880';
const WALLET_ACCOUNT = '37605544';

/**
 * Initiate wallet payment via M-Pesa STK Push
 * POST /api/wallet/initiate-payment
 */
export const initiateWalletPayment = async (req, res, next) => {
  try {
    const { saleId, phone, amount } = req.body;
    const userId = req.user?.id;

    if (!saleId || !phone || !amount || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: saleId, phone, amount',
      });
    }

    // Validate phone number format
    if (!/^(\+?254|0)[17][0-9]{8}$/.test(phone)) {
      return res.status(400).json({
        error: 'Invalid phone number format',
      });
    }

    // Get sale and verify ownership
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, sale.business_id), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!business) {
      return res.status(403).json({ error: 'Business not found or access denied' });
    }

    // Verify business is configured for wallet payments
    if (business.payment_method !== 'wallet') {
      return res.status(400).json({
        error: 'Business is not configured for wallet payments',
      });
    }

    // Parse amount and validate
    const paymentAmount = parseInt(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }

    // Create wallet payment record
    const [walletPayment] = await db
      .insert(walletPayments)
      .values({
        business_id: business.id,
        sale_id: saleId,
        amount_ksh: paymentAmount,
        phone,
        payment_status: 'pending',
        paybill: WALLET_PAYBILL,
        account_reference: WALLET_ACCOUNT,
        created_at: new Date(),
      })
      .returning();

    logger.info('Wallet payment initiated', {
      walletPaymentId: walletPayment.id,
      saleId,
      businessId: business.id,
      amount: paymentAmount,
      phone,
    });

    // Return wallet payment details
    res.status(201).json({
      message: 'Wallet payment initiated successfully',
      walletPayment: {
        id: walletPayment.id,
        saleId,
        amount: paymentAmount,
        phone,
        paybill: WALLET_PAYBILL,
        account: WALLET_ACCOUNT,
        paymentStatus: walletPayment.payment_status,
        createdAt: walletPayment.created_at,
        instructions: `To complete payment, use M-Pesa paybill ${WALLET_PAYBILL} with account number ${WALLET_ACCOUNT}`,
      },
    });
  } catch (error) {
    logger.error('Error initiating wallet payment', error);
    next(error);
  }
};

/**
 * Complete wallet payment (called via M-Pesa callback)
 * POST /api/wallet/complete-payment
 */
export const completeWalletPayment = async (req, res, next) => {
  try {
    const { walletPaymentId, mpesaTransactionId, status } = req.body;

    if (!walletPaymentId || !status) {
      return res.status(400).json({
        error: 'Missing required fields: walletPaymentId, status',
      });
    }

    // Get wallet payment
    const [walletPayment] = await db
      .select()
      .from(walletPayments)
      .where(eq(walletPayments.id, walletPaymentId))
      .limit(1);

    if (!walletPayment) {
      return res.status(404).json({ error: 'Wallet payment not found' });
    }

    if (status === 'success') {
      // Update payment status
      await db
        .update(walletPayments)
        .set({
          payment_status: 'completed',
          mpesa_transaction_id: mpesaTransactionId,
          updated_at: new Date(),
        })
        .where(eq(walletPayments.id, walletPaymentId));

      // Get wallet and update balance
      const [wallet] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.business_id, walletPayment.business_id))
        .limit(1);

      if (wallet) {
        const amountInTokens = Math.floor(walletPayment.amount_ksh / 2); // 1 token = KSH 2

        // Add transaction record
        await db.insert(walletTransactions).values({
          business_id: walletPayment.business_id,
          change_tokens: amountInTokens,
          type: 'purchase',
          reference: `PAYMENT-${walletPaymentId}`,
          note: `Wallet payment for sale #${walletPayment.sale_id}`,
          created_at: new Date(),
        });

        // Update wallet balance
        await db
          .update(wallets)
          .set({
            balance_tokens: wallet.balance_tokens + amountInTokens,
            updated_at: new Date(),
          })
          .where(eq(wallets.id, wallet.id));

        logger.info('Wallet payment completed successfully', {
          walletPaymentId,
          amountKsh: walletPayment.amount_ksh,
          tokensAdded: amountInTokens,
          businessId: walletPayment.business_id,
        });
      }
    } else if (status === 'failed') {
      // Update payment status to failed
      await db
        .update(walletPayments)
        .set({
          payment_status: 'failed',
          updated_at: new Date(),
        })
        .where(eq(walletPayments.id, walletPaymentId));

      logger.warn('Wallet payment failed', {
        walletPaymentId,
        businessId: walletPayment.business_id,
      });
    }

    res.status(200).json({
      message: 'Wallet payment status updated',
      status: status === 'success' ? 'Payment successful' : 'Payment failed',
    });
  } catch (error) {
    logger.error('Error completing wallet payment', error);
    next(error);
  }
};

/**
 * Get wallet payment status
 * GET /api/wallet/payment-status/:paymentId
 */
export const getWalletPaymentStatus = async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const userId = req.user?.id;

    const [walletPayment] = await db
      .select()
      .from(walletPayments)
      .where(eq(walletPayments.id, paymentId))
      .limit(1);

    if (!walletPayment) {
      return res.status(404).json({ error: 'Wallet payment not found' });
    }

    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(
          eq(businesses.id, walletPayment.business_id),
          eq(businesses.user_id, userId)
        )
      )
      .limit(1);

    if (!business) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.status(200).json({
      message: 'Wallet payment status retrieved',
      walletPayment: {
        id: walletPayment.id,
        saleId: walletPayment.sale_id,
        amount: walletPayment.amount_ksh,
        phone: walletPayment.phone,
        status: walletPayment.payment_status,
        mpesaTransactionId: walletPayment.mpesa_transaction_id,
        createdAt: walletPayment.created_at,
        updatedAt: walletPayment.updated_at,
      },
    });
  } catch (error) {
    logger.error('Error getting wallet payment status', error);
    next(error);
  }
};

/**
 * Get wallet balance for a business
 * GET /api/wallet/balance/:businessId
 */
export const getWalletBalance = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const userId = req.user?.id;

    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, businessId), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!business) {
      return res.status(403).json({ error: 'Business not found or access denied' });
    }

    // Get wallet
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.business_id, businessId))
      .limit(1);

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const walletValueKsh = wallet.balance_tokens * 2; // 1 token = KSH 2

    res.status(200).json({
      message: 'Wallet balance retrieved',
      wallet: {
        id: wallet.id,
        businessId: wallet.business_id,
        balanceTokens: wallet.balance_tokens,
        balanceKsh: walletValueKsh,
        createdAt: wallet.created_at,
        updatedAt: wallet.updated_at,
      },
    });
  } catch (error) {
    logger.error('Error getting wallet balance', error);
    next(error);
  }
};

/**
 * Get wallet transaction history
 * GET /api/wallet/transactions/:businessId
 */
export const getWalletTransactionHistory = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const userId = req.user?.id;

    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, businessId), eq(businesses.user_id, userId))
      )
      .limit(1);

    if (!business) {
      return res.status(403).json({ error: 'Business not found or access denied' });
    }

    const transactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId));

    res.status(200).json({
      message: 'Wallet transaction history retrieved',
      transactions: transactions.map(t => ({
        id: t.id,
        changeTokens: t.change_tokens,
        type: t.type,
        reference: t.reference,
        note: t.note,
        createdAt: t.created_at,
      })),
    });
  } catch (error) {
    logger.error('Error getting wallet transaction history', error);
    next(error);
  }
};

export default {
  initiateWalletPayment,
  completeWalletPayment,
  getWalletPaymentStatus,
  getWalletBalance,
  getWalletTransactionHistory,
};
