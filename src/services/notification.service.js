import logger from '#config/logger.js';
import { db } from '#config/database.js';
import {
  notifications,
  notificationPreferences,
  notificationTemplates,
} from '#models/notification.model.js';
import { users } from '#models/user.model.js';
import { eq, and } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import africastalking from 'africastalking';

// ============ AFRICAS TALKING SMS CONFIG ============

const AT = africastalking({
  apiKey: process.env.AFRICANTALKING_API_KEY,
  username: process.env.AFRICANTALKING_USERNAME,
});

// ============ EMAIL CONFIG (Nodemailer) ============
// Using Gmail example - you can change to SendGrid, your own SMTP, etc.

const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

// ============ NOTIFICATION SERVICE ============

export const notificationService = {
  // Create and send notification
  async createNotification({
    user_id,
    type, // 'payment_complete', 'low_stock', etc.
    channel = 'all', // 'in_app', 'sms', 'email', 'all'
    title,
    message,
    related_id,
    related_type,
    metadata = {},
  }) {
    try {
      // 1. Get user for SMS/email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, user_id))
        .limit(1);

      if (!user) {
        throw new Error(`User ${user_id} not found`);
      }

      // 2. Get user preferences
      const [prefs] = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.user_id, user_id))
        .limit(1);

      // 3. Check if user wants this notification type
      if (prefs && !this._isNotificationTypeEnabled(type, prefs)) {
        logger.info(
          `Notification ${type} disabled for user ${user_id}, skipping`
        );
        return null;
      }

      // 4. Create notification in DB
      const [notification] = await db
        .insert(notifications)
        .values({
          user_id,
          type,
          channel,
          title,
          message,
          related_id,
          related_type,
          metadata,
          sent_at: new Date(),
        })
        .returning();

      logger.info(`Notification ${notification.id} created for user ${user_id}`);

      // 5. Send via requested channels
      const sendPromises = [];

      if (channel === 'all' || channel === 'in_app') {
        // In-app is automatic (stored in DB above)
        logger.info(`In-app notification ready: ${notification.id}`);
      }

      if ((channel === 'all' || channel === 'sms') && prefs?.sms_enabled) {
        sendPromises.push(
          this._sendSMS(
            notification.id,
            prefs.sms_phone || user.phone_number,
            message,
            type
          )
        );
      }

      if ((channel === 'all' || channel === 'email') && prefs?.email_enabled) {
        sendPromises.push(
          this._sendEmail(notification.id, user.email, title, message, type)
        );
      }

      // Execute all sends in parallel
      await Promise.allSettled(sendPromises);

      return notification;
    } catch (e) {
      logger.error('Error creating notification', e);
      throw e;
    }
  },

  // Send SMS via AfricasTalking
  async _sendSMS(notificationId, phone, message, _type) {
    try {
      // Ensure phone is in correct format (+254XXXXXXXXX)
      const formattedPhone = this._formatPhone(phone);

      logger.info(`Sending SMS to ${formattedPhone} for notification ${notificationId}`);

      const response = await AT.SMS.send({
        to: [formattedPhone],
        message,
      });

      const result = response.data.SMSMessageData.Recipients[0];

      if (result.statusCode === 0) {
        // Success
        await db
          .update(notifications)
          .set({
            sms_sent: true,
            delivered_at: new Date(),
          })
          .where(eq(notifications.id, notificationId));

        logger.info(
          `SMS sent successfully to ${formattedPhone}, msgId: ${result.messageId}`
        );
      } else {
        // Failed
        const errorMsg = `SMS failed: ${result.statusMessage}`;
        await db
          .update(notifications)
          .set({
            sms_sent: false,
            sms_error: errorMsg,
          })
          .where(eq(notifications.id, notificationId));

        logger.warn(errorMsg);
      }
    } catch (e) {
      logger.error(`Error sending SMS for notification ${notificationId}`, e);

      // Update DB with error
      await db
        .update(notifications)
        .set({
          sms_sent: false,
          sms_error: e.message,
        })
        .where(eq(notifications.id, notificationId))
        .catch(err => logger.error('Error updating notification SMS error', err));
    }
  },

  // Send email via Nodemailer
  async _sendEmail(notificationId, email, title, message, type) {
    try {
      logger.info(`Sending email to ${email} for notification ${notificationId}`);

      // Get template
      const [template] = await db
        .select()
        .from(notificationTemplates)
        .where(eq(notificationTemplates.type, type))
        .limit(1);

      const subject = template?.email_subject || title;
      const htmlContent =
        template?.email_template ||
        `<h2>${title}</h2><p>${message}</p>`;

      const mailOptions = {
        from: process.env.SMTP_FROM || 'noreply@payme.app',
        to: email,
        subject,
        html: htmlContent,
      };

      const info = await emailTransporter.sendMail(mailOptions);

      // Success
      await db
        .update(notifications)
        .set({
          email_sent: true,
          delivered_at: new Date(),
        })
        .where(eq(notifications.id, notificationId));

      logger.info(`Email sent to ${email}, msgId: ${info.messageId}`);
    } catch (e) {
      logger.error(`Error sending email for notification ${notificationId}`, e);

      // Update DB with error
      await db
        .update(notifications)
        .set({
          email_sent: false,
          email_error: e.message,
        })
        .where(eq(notifications.id, notificationId))
        .catch(err => logger.error('Error updating notification email error', err));
    }
  },

  // Get user preferences (or create defaults)
  async getUserPreferences(userId) {
    try {
      let [prefs] = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.user_id, userId))
        .limit(1);

      if (!prefs) {
        // Create default preferences
        [prefs] = await db
          .insert(notificationPreferences)
          .values({
            user_id: userId,
            sms_enabled: true,
            email_enabled: true,
            in_app_enabled: true,
          })
          .returning();
      }

      return prefs;
    } catch (e) {
      logger.error('Error getting notification preferences', e);
      throw e;
    }
  },

  // Update user preferences
  async updatePreferences(userId, updates) {
    try {
      const [prefs] = await db
        .update(notificationPreferences)
        .set({
          ...updates,
          updated_at: new Date(),
        })
        .where(eq(notificationPreferences.user_id, userId))
        .returning();

      logger.info(`Notification preferences updated for user ${userId}`);
      return prefs;
    } catch (e) {
      logger.error('Error updating notification preferences', e);
      throw e;
    }
  },

  // Get user notifications (paginated)
  async getUserNotifications(userId, { limit = 20, offset = 0 } = {}) {
    try {
      const userNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.user_id, userId))
        .orderBy(notifications.created_at)
        .limit(limit)
        .offset(offset);

      return userNotifications;
    } catch (e) {
      logger.error('Error getting user notifications', e);
      throw e;
    }
  },

  // Mark notification as read
  async markAsRead(notificationId, userId) {
    try {
      const [notif] = await db
        .update(notifications)
        .set({
          is_read: true,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.user_id, userId)
          )
        )
        .returning();

      return notif;
    } catch (e) {
      logger.error('Error marking notification as read', e);
      throw e;
    }
  },

  // Mark all as read
  async markAllAsRead(userId) {
    try {
      await db
        .update(notifications)
        .set({
          is_read: true,
          updated_at: new Date(),
        })
        .where(eq(notifications.user_id, userId));

      logger.info(`All notifications marked as read for user ${userId}`);
    } catch (e) {
      logger.error('Error marking all as read', e);
      throw e;
    }
  },

  // Delete old notifications (cleanup)
  async deleteOldNotifications(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await db
        .delete(notifications)
        .where(notifications.created_at < cutoffDate);

      logger.info(`Deleted notifications older than ${daysOld} days`);
      return result;
    } catch (e) {
      logger.error('Error deleting old notifications', e);
      throw e;
    }
  },

  // ============ HELPER FUNCTIONS ============

  _formatPhone(phone) {
    // Normalize to +254 format
    if (!phone) return null;

    let formatted = phone.replace(/\s/g, '');

    if (formatted.startsWith('0')) {
      formatted = '+254' + formatted.substring(1);
    } else if (formatted.startsWith('254')) {
      formatted = '+' + formatted;
    } else if (!formatted.startsWith('+')) {
      formatted = '+' + formatted;
    }

    return formatted;
  },

  _isNotificationTypeEnabled(type, prefs) {
    const typeMap = {
      payment_complete: prefs.payment_notifications,
      payment_failed: prefs.payment_notifications,
      low_stock: prefs.stock_notifications,
      stock_expiring: prefs.stock_notifications,
      sale_created: prefs.sales_notifications,
      wallet_low: prefs.wallet_notifications,
      wallet_purchased: prefs.wallet_notifications,
      credit_payment_due: prefs.credit_notifications,
      expense_recorded: prefs.expense_notifications,
      daily_summary: prefs.daily_summary,
    };

    return typeMap[type] !== false; // Default to true if not specified
  },
};
