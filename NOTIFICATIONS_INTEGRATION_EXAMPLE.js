// ============================================================
// EXAMPLE: How to integrate notifications into sales flow
// ============================================================
// Copy-paste this into src/controllers/sales.controller.js

import logger from '#config/logger.js';
import { db } from '#config/database.js';
import { sales } from '#models/sales.model.js';
import { wallets } from '#models/wallet.model.js';
import { eq } from 'drizzle-orm';
import { emitNotification, notifications } from '#utils/notificationEmitter.js';

// ============ EXAMPLE: Payment Completion Handler ============

export const handlePaymentSuccess = async (req, res) => {
  try {
    const { saleId, stkRequestId } = req.body;

    // 1. Find sale
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    // 2. Update sale status
    await db.update(sales).set({
      payment_status: 'completed',
      paid_at: new Date(),
      stk_request_id: stkRequestId,
    }).where(eq(sales.id, saleId));

    // 3. Update wallet (deduct token)
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.user_id, sale.user_id))
      .limit(1);

    await db.update(wallets).set({
      balance: wallet.balance - 1,
      updated_at: new Date(),
    }).where(eq(wallets.id, wallet.id));

    // ============ 4. EMIT NOTIFICATION ============
    
    await emitNotification({
      user_id: sale.user_id,
      business_id: sale.business_id,
      ...notifications.paymentComplete({
        amount: sale.total,
        sale_id: sale.id,
        phone: sale.customer_phone,
      }),
    });

    logger.info(`Sale ${saleId} completed with notification sent`);

    // 5. Check wallet balance and warn if low
    if (wallet.balance - 1 < 5) {
      await emitNotification({
        user_id: sale.user_id,
        ...notifications.walletLow({
          balance: wallet.balance - 1,
        }),
      });
    }

    return res.status(200).json({
      message: 'Sale completed and customer notified',
      sale: {
        id: sale.id,
        total: sale.total,
        status: 'completed',
        notified: true,
      },
    });
  } catch (e) {
    logger.error('Error handling payment success', e);
    return res.status(500).json({
      error: 'Failed to complete payment',
      message: e.message,
    });
  }
};

// ============ EXAMPLE: Payment Failure Handler ============

export const handlePaymentFailure = async (req, res) => {
  try {
    const { saleId, reason } = req.body;

    // 1. Update sale
    await db.update(sales).set({
      payment_status: 'failed',
      updated_at: new Date(),
    }).where(eq(sales.id, saleId));

    // 2. EMIT FAILURE NOTIFICATION
    
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);

    await emitNotification({
      user_id: sale.user_id,
      business_id: sale.business_id,
      ...notifications.paymentFailed({
        amount: sale.total,
        sale_id: sale.id,
        reason: reason || 'Payment was declined',
      }),
    });

    logger.info(`Sale ${saleId} marked as failed with notification`);

    return res.status(200).json({
      message: 'Payment failure recorded and customer notified',
    });
  } catch (e) {
    logger.error('Error handling payment failure', e);
    return res.status(500).json({ error: 'Failed to record payment failure' });
  }
};

// ============ EXAMPLE: Stock Warning Handler ============

export const checkAndNotifyLowStock = async (_productId, _userId, _businessId) => {
  try {
    // Note: Uncomment and import { products } from '#models/stock.model.js'
    // const product = await db
    //   .select()
    //   .from(products)
    //   .where(eq(products.id, productId))
    //   .limit(1);

    // if (!product) return;

    // const minThreshold = 10; // Customize this

    // if (product.current_quantity < minThreshold) {
    //   await emitNotification({
    //     user_id: userId,
    //     business_id: businessId,
    //     ...notifications.lowStock({
    //       product_name: product.name,
    //       quantity: product.current_quantity,
    //       product_id: product.id,
    //     }),
    //   });

    //   logger.info(`Low stock notification sent for ${product.name}`);
    // }
  } catch (e) {
    logger.error('Error checking stock levels', e);
    // Don't throw - stock check shouldn't break main flow
  }
};

// ============ HOW TO USE ============
/*

In your sales controller:

1. After successful M-Pesa callback:
   await handlePaymentSuccess({
     body: { saleId: 123, stkRequestId: 'ws_CO_...' }
   }, res);

2. On payment failure:
   await handlePaymentFailure({
     body: { saleId: 123, reason: 'Insufficient funds' }
   }, res);

3. After stock deduction:
   await checkAndNotifyLowStock(productId, userId, businessId);

That's it! Notifications now flow automatically.
*/
