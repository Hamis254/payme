// ============ SOCKET.IO SETUP FOR REAL-TIME NOTIFICATIONS ============
// Note: socket.io is optional. If not installed, real-time notifications will be disabled.

import logger from '#config/logger.js';

let io;
let socketAvailable = false;

export const initializeSocket = async server => {
  try {
    // Try to dynamically import socket.io
    let SocketIO;
    try {
      const module = await import('socket.io');
      SocketIO = module.default;
    } catch {
      // socket.io not installed - disable real-time notifications
      logger.warn('socket.io not installed - real-time notifications disabled');
      return;
    }

    // If socket.io not available, skip initialization
    if (!SocketIO) {
      logger.warn('socket.io module not found - real-time notifications disabled');
      return;
    }

    const { Server } = SocketIO;

    io = new Server(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socketAvailable = true;

    // ============ AUTHENTICATION MIDDLEWARE ============

    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;

        if (!token) {
          return next(new Error('Authentication required'));
        }

        // Simple token validation (real implementation would verify JWT)
        if (token.length < 10) {
          return next(new Error('Invalid token'));
        }

        // Verify JWT from cookie/auth header
        const { jwttoken } = await import('#utils/jwt.js');
        const decoded = jwttoken.verify(token);

        if (!decoded || !decoded.id) {
          return next(new Error('Invalid token payload'));
        }

        socket.userId = decoded.id;
        socket.email = decoded.email;

        logger.info(
          `Socket authenticated: user ${decoded.email} (${socket.id})`
        );

        next();
      } catch (error) {
        logger.error('Socket authentication error:', error.message);
        next(new Error('Authentication failed'));
      }
    });

    // ============ CONNECTION HANDLER ============

    io.on('connection', socket => {
      logger.info(`Client connected: ${socket.id}, User: ${socket.email}`);

      // Join user's personal room (for targeted notifications)
      socket.join(`user:${socket.userId}`);

      // Subscribe to business notifications
      socket.on('subscribe:business', businessId => {
        socket.join(`business:${businessId}`);
        logger.info(`User ${socket.email} subscribed to business ${businessId}`);
      });

      // Unsubscribe from business notifications
      socket.on('unsubscribe:business', businessId => {
        socket.leave(`business:${businessId}`);
        logger.info(
          `User ${socket.email} unsubscribed from business ${businessId}`
        );
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });

      socket.on('error', err => {
        logger.error(`Socket error for ${socket.id}:`, err.message);
      });
    });

    logger.info('✓ Socket.io initialized for real-time notifications');
  } catch (error) {
    logger.error('Failed to initialize socket.io:', error.message);
    logger.warn('Real-time notifications disabled');
  }
};

// ============ EMIT FUNCTIONS ============

export const emitToUser = (userId, event, data) => {
  if (!socketAvailable) {
    logger.debug(`Socket not available. Event ${event} not emitted to user ${userId}`);
    return false;
  }
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
    return true;
  }
  return false;
};

export const emitToBusiness = (businessId, event, data) => {
  if (!socketAvailable) {
    logger.debug(`Socket not available. Event ${event} not emitted to business ${businessId}`);
    return false;
  }
  if (io) {
    io.to(`business:${businessId}`).emit(event, data);
    return true;
  }
  return false;
};

export const broadcastNotification = (userId, notification) => {
  return emitToUser(userId, 'notification', notification);
};

export { io };
