import logger from '#config/logger.js';
import { notificationService } from '#services/notification.service.js';
import { broadcastNotification, emitToBusiness } from '#config/socket.js';

// ============ NOTIFICATION EMITTER (Use this throughout app) ============
// Import and call this: emitNotification({user_id, type, ...})

export const emitNotification = async ({
  user_id,
  business_id,
  type,
  channel = 'all',
  title,
  message,
  related_id,
  related_type,
  metadata = {},
}) => {
  try {
    // Create notification in DB + send SMS/email
    const notification = await notificationService.createNotification({
      user_id,
      type,
      channel,
      title,
      message,
      related_id,
      related_type,
      metadata,
    });

    if (!notification) {
      logger.warn(`Notification creation returned null for user ${user_id}`);
      return;
    }

    // Emit via Socket.io (real-time)
    broadcastNotification(user_id, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      created_at: notification.created_at,
      metadata: notification.metadata,
    });

    // If business notification, also broadcast to business room
    if (business_id) {
      emitToBusiness(business_id, 'notification', {
        id: notification.id,
        user_id,
        type,
        title,
        created_at: notification.created_at,
      });
    }

    logger.info(`Notification emitted: ${type} for user ${user_id}`);
  } catch (e) {
    logger.error('Error emitting notification', e);
    // Don't throw - notifications shouldn't break the main flow
  }
};

// ============ PREDEFINED NOTIFICATION TEMPLATES ============

export const notifications = {
  // Payment notifications
  paymentComplete: (args) => ({
    type: 'payment_complete',
    channel: 'all',
    title: 'Payment Received ✅',
    message: `Payment of KES ${args.amount} completed successfully at ${new Date().toLocaleTimeString()}`,
    related_id: args.sale_id,
    related_type: 'sale',
    metadata: {
      amount: args.amount,
      sale_id: args.sale_id,
      phone: args.phone,
      payment_method: 'mpesa',
    },
  }),

  paymentFailed: (args) => ({
    type: 'payment_failed',
    channel: 'all',
    title: 'Payment Failed ❌',
    message: `Payment of KES ${args.amount} failed. ${args.reason || 'Please try again.'}`,
    related_id: args.sale_id,
    related_type: 'sale',
    metadata: {
      amount: args.amount,
      sale_id: args.sale_id,
      reason: args.reason,
    },
  }),

  // Stock notifications
  lowStock: (args) => ({
    type: 'low_stock',
    channel: 'sms', // SMS for urgent alerts
    title: '⚠️ Low Stock Alert',
    message: `${args.product_name} stock is low: ${args.quantity} units remaining. Reorder soon!`,
    related_id: args.product_id,
    related_type: 'product',
    metadata: {
      product_name: args.product_name,
      quantity: args.quantity,
      product_id: args.product_id,
    },
  }),

  stockExpiring: (args) => ({
    type: 'stock_expiring',
    channel: 'sms',
    title: '⚠️ Stock Expiring',
    message: `${args.product_name} expires on ${args.expiry_date}. ${args.quantity} units at risk.`,
    related_id: args.product_id,
    related_type: 'product',
    metadata: {
      product_name: args.product_name,
      expiry_date: args.expiry_date,
      quantity: args.quantity,
      product_id: args.product_id,
    },
  }),

  // Sale notifications
  saleCreated: (args) => ({
    type: 'sale_created',
    channel: 'in_app',
    title: 'New Sale Created',
    message: `Sale of KES ${args.total} created. Items: ${args.item_count}`,
    related_id: args.sale_id,
    related_type: 'sale',
    metadata: {
      total: args.total,
      item_count: args.item_count,
      sale_id: args.sale_id,
    },
  }),

  // Wallet notifications
  walletLow: (args) => ({
    type: 'wallet_low',
    channel: 'sms',
    title: '💰 Low Wallet Balance',
    message: `Your wallet balance is low: ${args.balance} tokens. Top up to continue selling.`,
    metadata: {
      balance: args.balance,
    },
  }),

  walletPurchased: (args) => ({
    type: 'wallet_purchased',
    channel: 'all',
    title: '💳 Tokens Purchased',
    message: `You purchased ${args.token_count} tokens for KES ${args.amount}. Balance: ${args.new_balance} tokens`,
    metadata: {
      token_count: args.token_count,
      amount: args.amount,
      new_balance: args.new_balance,
    },
  }),

  // Credit notifications
  creditPaymentDue: (args) => ({
    type: 'credit_payment_due',
    channel: 'sms',
    title: '💳 Credit Payment Due',
    message: `Payment of KES ${args.amount} due on ${args.due_date} from ${args.customer_name}`,
    related_id: args.credit_account_id,
    related_type: 'credit',
    metadata: {
      amount: args.amount,
      due_date: args.due_date,
      customer_name: args.customer_name,
      credit_account_id: args.credit_account_id,
    },
  }),

  // Expense notifications
  expenseRecorded: (args) => ({
    type: 'expense_recorded',
    channel: 'in_app',
    title: 'Expense Recorded',
    message: `${args.category} expense of KES ${args.amount} recorded: ${args.description}`,
    metadata: {
      category: args.category,
      amount: args.amount,
      description: args.description,
    },
  }),
};

// ============ EASY USAGE ============
/*
Import and use like:

import { emitNotification, notifications } from '#utils/notificationEmitter.js';

// In sales.controller.js after successful payment:
await emitNotification({
  user_id: userId,
  business_id: businessId,
  ...notifications.paymentComplete({
    amount: 500,
    sale_id: saleId,
    phone: customerPhone,
  }),
});

// For low stock:
await emitNotification({
  user_id: userId,
  ...notifications.lowStock({
    product_name: 'Rice 50kg',
    quantity: 5,
    product_id: productId,
  }),
});
*/
