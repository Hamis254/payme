import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
  wallets,
  walletTransactions,
  tokenPurchases,
} from '#models/myWallet.model.js';
import { businesses } from '#models/setting.model.js';
import { initiateTokenPurchase as initiateMpesaTokenPurchase } from '#utils/mpesa.js';
import { tokenPackages } from '#validations/wallet.validation.js';

// ============ WALLET INITIALIZATION ============

export const getOrCreateWallet = async (userId, businessId) => {
  try {
    // Verify user owns the business
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    // Get or create wallet
    let [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.business_id, businessId))
      .limit(1);

    if (!wallet) {
      [wallet] = await db
        .insert(wallets)
        .values({
          business_id: businessId,
          balance_tokens: 0,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      logger.info(`Wallet created for business ${businessId}`);
    }

    return wallet;
  } catch (e) {
    logger.error('Error getting/creating wallet', e);
    throw e;
  }
};

// ============ TOKEN PURCHASE VIA M-PESA ============

export const initiateTokenPurchase = async (
  userId,
  businessId,
  packageType,
  phone
) => {
  try {
    // Verify business ownership and get/create wallet
    const wallet = await getOrCreateWallet(userId, businessId);

    // Get package details
    const packageInfo = tokenPackages[packageType];
    if (!packageInfo) throw new Error('Invalid package type');

    // Create pending token purchase record
    const [purchase] = await db
      .insert(tokenPurchases)
      .values({
        business_id: businessId,
        package_type: packageType,
        tokens_purchased: packageInfo.tokens,
        amount_paid: String(packageInfo.price),
        payment_method: 'mpesa',
        status: 'pending',
        mpesa_phone: phone,
        created_at: new Date(),
      })
      .returning();

    // Initiate M-Pesa STK Push using platform wallet paybill
    // All token purchases go to 650880 with account 37605544
    const mpesaResp = await initiateMpesaTokenPurchase({
      phone,
      amount: packageInfo.price,
      accountReference: `TOKEN-${purchase.id}`,
    });

    // Update purchase with STK request ID
    await db
      .update(tokenPurchases)
      .set({
        stk_request_id: mpesaResp.CheckoutRequestID || null,
        callback_payload: JSON.stringify(mpesaResp),
      })
      .where(eq(tokenPurchases.id, purchase.id));

    logger.info(
      `Token purchase initiated: ${packageInfo.tokens} tokens for business ${businessId}`
    );

    return {
      purchaseId: purchase.id,
      tokens: packageInfo.tokens,
      amount: packageInfo.price,
      checkoutRequestId: mpesaResp.CheckoutRequestID,
      currentBalance: wallet.balance_tokens,
    };
  } catch (e) {
    logger.error('Error initiating token purchase', e);
    throw e;
  }
};

// ============ M-PESA CALLBACK PROCESSING (TOKEN PURCHASE) ============

/**
 * Process M-Pesa STK callback for token purchases
 * - Validates callback structure
 * - Checks for duplicate processing (idempotency)
 * - Updates purchase record atomically
 * - Adds tokens to wallet on success
 * - Logs all transactions
 *
 * @param {Object} callbackData - M-Pesa stkCallback data
 * @returns {Promise<Object>} Processing result
 */
export const processTokenPurchaseCallback = async callbackData => {
  const callbackId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

  try {
    if (!callbackData || !callbackData.CheckoutRequestID) {
      logger.warn('Invalid token purchase callback data', { callbackId });
      return { status: 'ignored', callbackId };
    }

    const {
      CheckoutRequestID: checkoutRequestId,
      ResultCode: resultCode,
      CallbackMetadata,
    } = callbackData;

    logger.info('Processing token purchase callback', {
      callbackId,
      checkoutRequestId,
      resultCode,
    });

    // ============ ATOMICALLY PROCESS CALLBACK ============

    await db.transaction(async tx => {
      // Get purchase by STK request ID
      const [purchase] = await tx
        .select()
        .from(tokenPurchases)
        .where(eq(tokenPurchases.stk_request_id, checkoutRequestId))
        .limit(1);

      if (!purchase) {
        logger.warn('Token purchase not found for callback', {
          callbackId,
          checkoutRequestId,
        });
        return;
      }

      // Idempotency check: if already processed, skip
      if (purchase.callback_processed) {
        logger.info('Token purchase callback already processed, skipping', {
          callbackId,
          purchaseId: purchase.id,
        });
        return;
      }

      // Parse M-Pesa metadata
      const metadataItems = CallbackMetadata?.Item || [];
      const amount = Number(
        metadataItems.find(i => i.Name === 'Amount')?.Value ||
          purchase.amount_paid
      );
      const mpesaReceiptNumber =
        metadataItems.find(i => i.Name === 'MpesaReceiptNumber')?.Value || null;
      const phoneNumber =
        metadataItems.find(i => i.Name === 'PhoneNumber')?.Value || null;

      if (resultCode === 0) {
        // ============ PAYMENT SUCCESSFUL - ADD TOKENS ============
        logger.info('Token purchase payment successful', {
          purchaseId: purchase.id,
          tokens: purchase.tokens_purchased,
          amount,
        });

        // Update purchase record with success status
        await tx
          .update(tokenPurchases)
          .set({
            status: 'success',
            mpesa_transaction_id: mpesaReceiptNumber,
            mpesa_phone: phoneNumber || purchase.mpesa_phone,
            callback_processed: true,
            callback_payload: JSON.stringify(callbackData),
            completed_at: new Date(),
          })
          .where(eq(tokenPurchases.id, purchase.id));

        // Get wallet and add tokens
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.business_id, purchase.business_id))
          .limit(1);

        if (!wallet) {
          logger.error('Wallet not found for token purchase', {
            businessId: purchase.business_id,
          });
          throw new Error('Wallet not found');
        }

        const newBalance = wallet.balance_tokens + purchase.tokens_purchased;

        // Update wallet balance
        await tx
          .update(wallets)
          .set({
            balance_tokens: newBalance,
            updated_at: new Date(),
          })
          .where(eq(wallets.id, wallet.id));

        // Log wallet transaction (purchase)
        await tx.insert(walletTransactions).values({
          business_id: purchase.business_id,
          change_tokens: purchase.tokens_purchased,
          type: 'purchase',
          reference: String(purchase.id),
          note: `Token package: ${purchase.package_type} - M-Pesa ${mpesaReceiptNumber}`,
          created_at: new Date(),
          created_by: null,
        });

        logger.info('Token purchase completed successfully', {
          purchaseId: purchase.id,
          tokensAdded: purchase.tokens_purchased,
          newBalance,
          receipt: mpesaReceiptNumber,
        });
      } else {
        // ============ PAYMENT FAILED ============
        logger.warn('Token purchase payment failed', {
          purchaseId: purchase.id,
          resultCode,
        });

        // Mark purchase as failed
        await tx
          .update(tokenPurchases)
          .set({
            status: 'failed',
            callback_processed: true,
            callback_payload: JSON.stringify(callbackData),
          })
          .where(eq(tokenPurchases.id, purchase.id));

        // Log failed transaction
        await tx.insert(walletTransactions).values({
          business_id: purchase.business_id,
          change_tokens: 0,
          type: 'purchase',
          reference: String(purchase.id),
          note: `Token purchase failed (code: ${resultCode})`,
          created_at: new Date(),
          created_by: null,
        });

        logger.info('Token purchase failed - no tokens added', {
          purchaseId: purchase.id,
          resultCode,
        });
      }
    });

    return {
      status: 'processed',
      callbackId,
      checkoutRequestId,
    };
  } catch (error) {
    logger.error('Token purchase callback processing error', {
      callbackId,
      error: error.message,
      stack: error.stack,
    });

    // Return success to M-Pesa to prevent retries
    return {
      status: 'error_recorded',
      callbackId,
      message: 'Error recorded, support will investigate',
    };
  }
};

// ============ MANUAL TOKEN ADDITION (CASH/ADMIN) ============

export const addTokensManually = async (
  userId,
  businessId,
  tokens,
  note,
  paymentMethod
) => {
  try {
    const wallet = await getOrCreateWallet(userId, businessId);

    await db.transaction(async tx => {
      // Calculate price (2 KSH per token for manual addition)
      const price = tokens * 2;

      // Create purchase record
      await tx.insert(tokenPurchases).values({
        business_id: businessId,
        package_type: 'custom',
        tokens_purchased: tokens,
        amount_paid: String(price),
        payment_method: paymentMethod,
        status: 'success',
        completed_at: new Date(),
        created_at: new Date(),
      });

      // Update wallet balance
      await tx
        .update(wallets)
        .set({
          balance_tokens: wallet.balance_tokens + tokens,
          updated_at: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

      // Log transaction
      await tx.insert(walletTransactions).values({
        business_id: businessId,
        change_tokens: tokens,
        type: 'purchase',
        reference: null,
        note: note || `Manual token addition - ${paymentMethod}`,
        created_at: new Date(),
        created_by: userId,
      });
    });

    logger.info(
      `${tokens} tokens manually added to business ${businessId} by user ${userId}`
    );

    return {
      tokensAdded: tokens,
      newBalance: wallet.balance_tokens + tokens,
    };
  } catch (e) {
    logger.error('Error adding tokens manually', e);
    throw e;
  }
};

// ============ WALLET QUERIES ============

export const getWalletBalance = async (userId, businessId) => {
  try {
    const wallet = await getOrCreateWallet(userId, businessId);

    // Get recent transactions
    const recentTransactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId))
      .orderBy(desc(walletTransactions.created_at))
      .limit(5);

    // Get total tokens purchased
    const totalPurchased = await db
      .select({
        total: sql`COALESCE(SUM(${walletTransactions.change_tokens}), 0)`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.business_id, businessId),
          eq(walletTransactions.type, 'purchase')
        )
      );

    // Get total tokens used
    const totalUsed = await db
      .select({
        total: sql`COALESCE(SUM(ABS(${walletTransactions.change_tokens})), 0)`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.business_id, businessId),
          eq(walletTransactions.type, 'charge')
        )
      );

    return {
      balance: wallet.balance_tokens,
      totalPurchased: Number(totalPurchased[0]?.total || 0),
      totalUsed: Number(totalUsed[0]?.total || 0),
      recentTransactions,
    };
  } catch (e) {
    logger.error('Error getting wallet balance', e);
    throw e;
  }
};

export const getWalletTransactions = async (
  userId,
  businessId,
  filters = {}
) => {
  try {
    // Verify business ownership
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const { type = 'all', limit = 50, offset = 0 } = filters;

    let query = db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId))
      .orderBy(desc(walletTransactions.created_at))
      .limit(limit)
      .offset(offset);

    // Apply type filter
    if (type !== 'all') {
      query = query.where(eq(walletTransactions.type, type));
    }

    const transactions = await query;

    return {
      transactions,
      count: transactions.length,
      hasMore: transactions.length === limit,
    };
  } catch (e) {
    logger.error('Error getting wallet transactions', e);
    throw e;
  }
};

export const getTokenPurchaseHistory = async (
  userId,
  businessId,
  filters = {}
) => {
  try {
    // Verify business ownership
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const { status = 'all', limit = 20 } = filters;

    let query = db
      .select()
      .from(tokenPurchases)
      .where(eq(tokenPurchases.business_id, businessId))
      .orderBy(desc(tokenPurchases.created_at))
      .limit(limit);

    // Apply status filter
    if (status !== 'all') {
      query = query.where(eq(tokenPurchases.status, status));
    }

    const purchases = await query;

    return {
      purchases,
      count: purchases.length,
    };
  } catch (e) {
    logger.error('Error getting token purchase history', e);
    throw e;
  }
};

// ============ WALLET STATISTICS ============

export const getWalletStats = async (userId, businessId) => {
  try {
    const wallet = await getOrCreateWallet(userId, businessId);

    // Get purchase statistics
    const purchaseStats = await db
      .select({
        totalAmount: sql`COALESCE(SUM(CAST(${tokenPurchases.amount_paid} AS DECIMAL)), 0)`,
        totalTokens: sql`COALESCE(SUM(${tokenPurchases.tokens_purchased}), 0)`,
        count: sql`COUNT(*)`,
      })
      .from(tokenPurchases)
      .where(
        and(
          eq(tokenPurchases.business_id, businessId),
          eq(tokenPurchases.status, 'success')
        )
      );

    // Get usage statistics by type
    const usageStats = await db
      .select({
        type: walletTransactions.type,
        totalTokens: sql`SUM(${walletTransactions.change_tokens})`,
        count: sql`COUNT(*)`,
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId))
      .groupBy(walletTransactions.type);

    return {
      currentBalance: wallet.balance_tokens,
      totalSpent: Number(purchaseStats[0]?.totalAmount || 0),
      totalPurchased: Number(purchaseStats[0]?.totalTokens || 0),
      purchaseCount: Number(purchaseStats[0]?.count || 0),
      usageByType: usageStats.map(stat => ({
        type: stat.type,
        tokens: Number(stat.totalTokens),
        count: Number(stat.count),
      })),
    };
  } catch (e) {
    logger.error('Error getting wallet stats', e);
    throw e;
  }
};
