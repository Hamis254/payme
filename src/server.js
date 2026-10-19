import { createServer } from 'http';
import logger from '#config/logger.js';
import app from './app.js';
import { pgPool } from '#config/database.js';
import { initializeSocket } from '#config/socket.js';
import {
  startOfflineSyncJob,
  stopOfflineSyncJob,
} from '#services/offlineSyncJob.js';
import {
  startNotificationScheduler,
  stopNotificationScheduler,
} from '#services/notificationScheduler.js';
import {
  startAttemptSweeper,
  stopAttemptSweeper,
} from '#services/mpesaAttempt.service.js';

const PORT = process.env.PORT || 3000;

// Wrap the Express app in a raw HTTP server so socket.io can attach to the
// same port instead of needing a second listener.
const server = createServer(app);

server.listen(PORT, () => {
  logger.info(`Listening on http://localhost:${PORT}`);

  // Real-time notifications over the same HTTP server.
  initializeSocket(server);

  // Background job that replays queued offline mutations once connectivity
  // returns (see services/offlineSyncJob.js for the full flow).
  startOfflineSyncJob();
  startNotificationScheduler();

  // Releases stock held by STK pushes that never got a callback. Without
  // this, one dropped callback keeps a unit unsellable indefinitely.
  startAttemptSweeper();
});
// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
// Stop taking new work, let in-flight requests finish, close the DB pool.
// Matters most for the neon-serverless Pool driver, which holds an open
// WebSocket connection that should be closed explicitly on exit.

const shutdown = async signal => {
  logger.info(`${signal} received — shutting down gracefully`);

  stopOfflineSyncJob();
  stopNotificationScheduler();
  stopAttemptSweeper();

  server.close(async () => {
    try {
      await pgPool.end();
      logger.info('Database pool closed. Goodbye.');
      process.exit(0);
    } catch (e) {
      logger.error(`Error closing database pool: ${e}`);
      process.exit(1);
    }
  });

  // Failsafe: if something hangs, force-exit after 10s instead of leaving
  // the process stuck.
  setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;