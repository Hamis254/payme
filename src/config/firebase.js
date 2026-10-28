import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import logger from '#config/logger.js';

let messaging;
let initialized = false;

export const getFirebaseMessaging = () => {
  if (initialized) return messaging;
  initialized = true;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON not configured - push notifications disabled');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(
      Buffer.from(serviceAccountJson, 'base64').toString('utf8')
    );
    const app =
      getApps()[0] ||
      initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging(app);
    logger.info('Firebase Cloud Messaging initialized');
    return messaging;
  } catch (error) {
    logger.error('Firebase initialization failed - push notifications disabled', {
      error: error.message,
    });
    return null;
  }
};
