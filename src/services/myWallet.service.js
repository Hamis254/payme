import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { eq, and, desc } from 'drizzle-orm';
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
    const wallet = await getOrCreateWallet(userId, businessId);

    const packageInfo = tokenPackages[packageType];
    if (!packageInfo) throw new Error('Invalid package type');

    // Token purchases always use the platform wallet paybill (650880)

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

    const mpesaResp = await initiateMpesaTokenPurchase({
      phone,
      amount: packageInfo.price,
      accountReference: `TOKEN-${purchase.id}`,
    });

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

// ============ M-PESA CALLBACK PROCESSING ============

export const processTokenPurchaseCallback = async callbackData => {
  try {
    const { CheckoutRequestID, ResultCode } = callbackData;
    const items =
      (callbackData.CallbackMetadata && callbackData.CallbackMetadata.Item) ||
      [];

    const [purchase] = await db
      .select()
      .from(tokenPurchases)
      .where(eq(tokenPurchases.stk_request_id, CheckoutRequestID))
      .limit(1);

    if (!purchase) {
      logger.warn(`Unknown token purchase callback: ${CheckoutRequestID}`);
      return { status: 'ignored' };
    }

    if (purchase.status === 'success' || purchase.status === 'failed') {
      return { status: 'already_processed' };
    }

    const mpesaReceipt =
      items.find(i => i.Name === 'MpesaReceiptNumber')?.Value || null;
    const phone = items.find(i => i.Name === 'PhoneNumber')?.Value || null;

    if (ResultCode === 0) {
      await db.transaction(async tx => {
        await tx
          .update(tokenPurchases)
          .set({
            status: 'success',
            mpesa_transaction_id: mpesaReceipt,
            mpesa_phone: phone || purchase.mpesa_phone,
            callback_payload: JSON.stringify(callbackData),
            completed_at: new Date(),
          })
          .where(eq(tokenPurchases.id, purchase.id));

        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.business_id, purchase.business_id))
          .limit(1);

        const newBalance = wallet.balance_tokens + purchase.tokens_purchased;

        await tx
          .update(wallets)
          .set({
            balance_tokens: newBalance,
            updated_at: new Date(),
          })
          .where(eq(wallets.id, wallet.id));

        await tx.insert(walletTransactions).values({
          business_id: purchase.business_id,
          change_tokens: purchase.tokens_purchased,
          type: 'purchase',
          reference: String(purchase.id),
          note: `Token purchase - ${purchase.package_type} package`,
          created_at: new Date(),
        });
      });

      logger.info(
        `Token purchase completed: ${purchase.tokens_purchased} tokens added to business ${purchase.business_id}`
      );

      return {
        status: 'success',
        purchaseId: purchase.id,
        tokensAdded: purchase.tokens_purchased,
      };
    } else {
      await db
        .update(tokenPurchases)
        .set({
          status: 'failed',
          callback_payload: JSON.stringify(callbackData),
        })
        .where(eq(tokenPurchases.id, purchase.id));

      logger.info(`Token purchase failed: purchase ${purchase.id}`);

      return {
        status: 'failed',
        purchaseId: purchase.id,
      };
    }
  } catch (e) {
    logger.error('Error processing token purchase callback', e);
    throw e;
  }
};

// ============ MANUAL TOKEN ADDITION ============

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
      const price = tokens * 2;

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

      await tx
        .update(wallets)
        .set({
          balance_tokens: wallet.balance_tokens + tokens,
          updated_at: new Date(),
        })
        .where(eq(wallets.id, wallet.id));

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

    logger.info(`${tokens} tokens manually added to business ${businessId}`);

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

    const recentTransactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.business_id, businessId))
      .orderBy(desc(walletTransactions.created_at))
      .limit(5);

    return {
      balance: wallet.balance_tokens,
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
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const { type = 'all', limit = 50, offset = 0 } = filters;

    const conditions = [eq(walletTransactions.business_id, businessId)];
    if (type !== 'all') {
      conditions.push(eq(walletTransactions.type, type));
    }

    const transactions = await db
      .select()
      .from(walletTransactions)
      .where(and(...conditions))
      .orderBy(desc(walletTransactions.created_at))
      .limit(limit)
      .offset(offset);

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
    const [business] = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.user_id, userId)))
      .limit(1);

    if (!business) throw new Error('Business not found or access denied');

    const { status = 'all', limit = 20 } = filters;

    const conditions = [eq(tokenPurchases.business_id, businessId)];
    if (status !== 'all') {
      conditions.push(eq(tokenPurchases.status, status));
    }

    const purchases = await db
      .select()
      .from(tokenPurchases)
      .where(and(...conditions))
      .orderBy(desc(tokenPurchases.created_at))
      .limit(limit);

    return {
      purchases,
      count: purchases.length,
    };
  } catch (e) {
    logger.error('Error getting token purchase history', e);
    throw e;
  }
};
