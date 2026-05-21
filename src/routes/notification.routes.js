import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import { validateRequest } from '#middleware/validation.middleware.js';
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getPreferences,
  updatePreferences,
  testNotification,
} from '#controllers/notification.controller.js';
import {
  updatePreferencesSchema,
  testNotificationSchema,
} from '#validations/notification.validation.js';

const router = express.Router();

const restrictTestNotificationRoute = (_req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Test notification endpoint is disabled in production',
    });
  }
  return next();
};

// ============ AUTHENTICATION REQUIRED ============

// Get all notifications for user
router.get('/', authenticateToken, getUserNotifications);

// Get notification preferences
router.get('/preferences', authenticateToken, getPreferences);

// Mark specific notification as read
router.patch('/:notificationId/read', authenticateToken, markAsRead);

// Mark all notifications as read
router.patch('/read/all', authenticateToken, markAllAsRead);

// Update notification preferences
router.patch(
  '/preferences',
  authenticateToken,
  validateRequest(updatePreferencesSchema),
  updatePreferences
);

// Test send notification (for development)
router.post(
  '/test',
  authenticateToken,
  restrictTestNotificationRoute,
  validateRequest(testNotificationSchema),
  testNotification
);

export default router;
