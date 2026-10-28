import { inArray, eq } from 'drizzle-orm';
import { db } from '#config/database.js';
import { deviceTokens } from '#models/deviceToken.model.js';
import { getFirebaseMessaging } from '#config/firebase.js';
import logger from '#config/logger.js';

const MAX_MULTICAST_TOKENS = 500;
const UNREGISTERED_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export const sendPushNotification = async (
  userId,
  { notificationId, type, title, message, businessId }
) => {
  try {
    const messaging = getFirebaseMessaging();
    if (!messaging) return;

    const tokens = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(eq(deviceTokens.user_id, userId));

    for (let start = 0; start < tokens.length; start += MAX_MULTICAST_TOKENS) {
      const chunk = tokens.slice(start, start + MAX_MULTICAST_TOKENS);
      const response = await messaging.sendEachForMulticast({
        tokens: chunk.map(row => row.token),
        notification: { title, body: message },
        data: {
          notification_id: String(notificationId),
          type: String(type),
          business_id: String(businessId ?? ''),
        },
        android: {
          priority: 'high',
          notification: { channelId: 'payme_alerts' },
        },
      });

      const invalidTokens = response.responses
        .map((result, index) =>
          result.error && UNREGISTERED_CODES.has(result.error.code)
            ? chunk[index].token
            : null
        )
        .filter(Boolean);

      if (invalidTokens.length > 0) {
        try {
          await db
            .delete(deviceTokens)
            .where(inArray(deviceTokens.token, invalidTokens));
        } catch (error) {
          logger.error('Failed to remove unregistered device tokens', {
            userId,
            tokenCount: invalidTokens.length,
            error: error.message,
          });
        }
      }
    }
  } catch (error) {
    logger.error('Failed to send push notification', {
      userId,
      error: error.message,
    });
  }
};
