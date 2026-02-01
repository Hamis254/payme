import express from 'express';
import { authenticateToken } from '#middleware/auth.middleware.js';
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getPreferences,
  updatePreferences,
  testNotification,
} from '#controllers/notification.controller.js';
import { updatePreferencesSchema, testNotificationSchema } from '#validations/notification.validation.js';
import { formatValidationError } from '#utils/validation.js';

const router = express.Router();

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
router.patch('/preferences', authenticateToken, (req, res, next) => {
  const validationResult = updatePreferencesSchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: formatValidationError(validationResult.error),
    });
  }
  req.validatedBody = validationResult.data;
  req.body = req.validatedBody;
  next();
}, updatePreferences);

// Test send notification (for development)
router.post('/test', authenticateToken, (req, res, next) => {
  const validationResult = testNotificationSchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: formatValidationError(validationResult.error),
    });
  }
  req.validatedBody = validationResult.data;
  req.body = req.validatedBody;
  next();
}, testNotification);

export default router;
