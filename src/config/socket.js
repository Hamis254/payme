import { Server } from 'socket.io';
import logger from '#config/logger.js';
import { jwttoken } from '#utils/jwt.js';

// ============ SOCKET.IO SETUP FOR REAL-TIME NOTIFICATIONS ============

let io;

export const initializeSocket = server => {
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

  // ============ AUTHENTICATION MIDDLEWARE ============

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwttoken.verify(token);
      socket.userId = decoded.id;
      socket.email = decoded.email;

      logger.info(
        `Socket authenticated: user ${decoded.email} (${socket.id})`
      );
      next();
    } catch (e) {
      logger.error('Socket authentication error', e);
      next(new Error('Authentication failed'));
    }
  });

  // ============ CONNECTION HANDLERS ============

  io.on('connection', socket => {
    const userId = socket.userId;
    logger.info(`User ${userId} connected, socketId: ${socket.id}`);

    // Join user's personal room (for targeted notifications)
    socket.join(`user:${userId}`);

    // ============ EVENTS ============

    // Subscribe to business notifications
    socket.on('subscribe:business', businessId => {
      socket.join(`business:${businessId}`);
      logger.info(
        `User ${userId} subscribed to business ${businessId}`
      );
    });

    // Unsubscribe from business
    socket.on('unsubscribe:business', businessId => {
      socket.leave(`business:${businessId}`);
      logger.info(
        `User ${userId} unsubscribed from business ${businessId}`
      );
    });

    // Heartbeat (keep-alive)
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // ============ DISCONNECTION ============

    socket.on('disconnect', reason => {
      logger.info(`User ${userId} disconnected: ${reason}`);
    });

    socket.on('error', error => {
      logger.error(`Socket error for user ${userId}`, error);
    });
  });

  logger.info('Socket.io initialized');
  return io;
};

// ============ EMIT HELPERS (Call these from your code) ============

export const emitToUser = (userId, event, data) => {
  if (!io) {
    logger.warn('Socket.io not initialized');
    return;
  }

  io.to(`user:${userId}`).emit(event, data);
  logger.info(`Emitted ${event} to user ${userId}`);
};

export const emitToBusiness = (businessId, event, data) => {
  if (!io) {
    logger.warn('Socket.io not initialized');
    return;
  }

  io.to(`business:${businessId}`).emit(event, data);
  logger.info(`Emitted ${event} to business ${businessId}`);
};

export const broadcastNotification = (userId, notification) => {
  emitToUser(userId, 'notification', notification);
};

export const getSocket = () => io;
