import app from './app.js';
import logger from '#config/logger.js';
import http from 'http';
import { initializeSocket } from '#config/socket.js';

// ============ ENVIRONMENT VALIDATION ============

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ARCJET_KEY',
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
  'MPESA_PASSKEY', // Passkey for wallet paybill (650880)
  'MPESA_CALLBACK_URL',
  'MPESA_B2C_SHORTCODE',
  'MPESA_B2C_SECURITY_CREDENTIAL',
  'MPESA_B2C_INITIATOR',
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
});

// ============ GRACEFUL SHUTDOWN ============

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

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
