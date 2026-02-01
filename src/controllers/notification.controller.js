import logger from '#config/logger.js';
import { notificationService } from '#services/notification.service.js';

// ============ NOTIFICATION CONTROLLERS ============

// Get user notifications
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    const notifications = await notificationService.getUserNotifications(
      userId,
      {
        limit: parseInt(limit),
        offset: parseInt(offset),
      }
    );

    return res.status(200).json({
      message: 'Notifications retrieved',
      count: notifications.length,
      notifications,
    });
  } catch (e) {
    logger.error('Error getting notifications', e);
    return res.status(500).json({
      error: 'Failed to retrieve notifications',
      message: e.message,
    });
  }
};

// Mark notification as read
export const markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;

    const notif = await notificationService.markAsRead(
      parseInt(notificationId),
      userId
    );

    if (!notif) {
      return res.status(404).json({
        error: 'Notification not found',
      });
    }

    return res.status(200).json({
      message: 'Notification marked as read',
      notification: notif,
    });
  } catch (e) {
    logger.error('Error marking notification as read', e);
    return res.status(500).json({
      error: 'Failed to mark notification as read',
      message: e.message,
    });
  }
};

// Mark all as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await notificationService.markAllAsRead(userId);

    return res.status(200).json({
      message: 'All notifications marked as read',
    });
  } catch (e) {
    logger.error('Error marking all as read', e);
    return res.status(500).json({
      error: 'Failed to mark all as read',
      message: e.message,
    });
  }
};

// Get notification preferences
export const getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;

    const prefs = await notificationService.getUserPreferences(userId);

    return res.status(200).json({
      message: 'Preferences retrieved',
      preferences: prefs,
    });
  } catch (e) {
    logger.error('Error getting preferences', e);
    return res.status(500).json({
      error: 'Failed to retrieve preferences',
      message: e.message,
    });
  }
};

// Update notification preferences
export const updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Validate update fields
    const allowedFields = [
      'sms_enabled',
      'email_enabled',
      'in_app_enabled',
      'payment_notifications',
      'stock_notifications',
      'sales_notifications',
      'wallet_notifications',
      'credit_notifications',
      'expense_notifications',
      'daily_summary',
      'sms_phone',
      'quiet_hours_enabled',
      'quiet_start',
      'quiet_end',
    ];

    const cleanUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        cleanUpdates[key] = value;
      }
    }

    const prefs = await notificationService.updatePreferences(
      userId,
      cleanUpdates
    );

    return res.status(200).json({
      message: 'Preferences updated',
      preferences: prefs,
    });
  } catch (e) {
    logger.error('Error updating preferences', e);
    return res.status(500).json({
      error: 'Failed to update preferences',
      message: e.message,
    });
  }
};

// Test send notification (for testing)
export const testNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = 'payment_complete', channel = 'all' } = req.body;

    const notification = await notificationService.createNotification({
      user_id: userId,
      type,
      channel,
      title: `Test ${type} notification`,
      message: `This is a test notification sent at ${new Date().toISOString()}`,
      metadata: {
        isTest: true,
      },
    });

    return res.status(201).json({
      message: 'Test notification sent',
      notification,
    });
  } catch (e) {
    logger.error('Error sending test notification', e);
    return res.status(500).json({
      error: 'Failed to send test notification',
      message: e.message,
    });
  }
};
