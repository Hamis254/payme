import app from './app.js';
import logger from '#config/logger.js';
import http from 'http';
import { initializeSocket } from '#config/socket.js';
import {
  startOfflineSyncJob,
  stopOfflineSyncJob,
} from '#services/offlineSyncJob.js';

// ============ ENVIRONMENT VALIDATION ============

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ARCJET_KEY',
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
  'MPESA_PASSKEY',
  'MPESA_CALLBACK_URL',
  'MPESA_B2C_SHORTCODE',
  'MPESA_B2C_SECURITY_CREDENTIAL',
  'MPESA_B2C_INITIATOR',
  'ENCRYPTION_KEY', // ← was missing; encryption.js throws on startup without it
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  logger.error('Missing required environment variables:', {
    missing: missingVars,
  });
  console.error(
    `❌ Fatal: Missing environment variables: ${missingVars.join(', ')}`
  );
  process.exit(1);
}

logger.info('✓ All required environment variables validated');

// ============ START SERVER ============

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// Initialize Socket.io
initializeSocket(server).catch(error => {
  logger.warn('Socket.io initialization failed:', error.message);
});

server.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT}`);
  console.log(`✓ PayMe API running on http://localhost:${PORT}`);

  // Start the offline sync background job AFTER the server is fully up so
  // the internal HTTP calls the job makes hit a live server.
  startOfflineSyncJob();
});

// ============ GRACEFUL SHUTDOWN ============

const shutdown = signal => {
  logger.info(`${signal} received — shutting down gracefully`);

  // Stop the sync job first so in-flight replays can finish
  stopOfflineSyncJob();

  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force-exit after 10 s if something hangs
  setTimeout(() => {
    logger.error('Forced exit after 10 s timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============ GLOBAL ERROR HANDLING ============

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', {
    promise,
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : null,
  });
});

process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
