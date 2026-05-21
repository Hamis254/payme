import express from 'express';
import logger from '#config/logger.js';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from '#routes/auth.routes.js';
import securityMiddleware from '#middleware/security.middleware.js';
import usersRoutes from '#routes/users.routes.js';
import businessesRoutes from '#routes/businesses.routes.js';
import stockRoutes from '#routes/stock.routes.js';
import salesRoutes from '#routes/sales.routes.js';
import paymeRoutes from '#routes/payme.routes.js';
import creditRoutes from '#routes/credit.routes.js';
import walletRoutes from '#routes/wallet.routes.js';
import walletPaymentRoutes from '#routes/walletPayment.routes.js';
import paymentConfigRoutes from '#routes/paymentConfig.routes.js';
import recordRoutes from '#routes/record.routes.js';
import expenseRoutes from '#routes/expense.routes.js';
import myWalletRoutes from '#routes/myWallet.routes.js';
import spoiledStockRoutes from '#routes/spoiledStock.routes.js';
import hirePurchaseRoutes from '#routes/higherPurchase.routes.js';
import statementVerificationRoutes from '#routes/statementVerification.routes.js';
import notificationRoutes from '#routes/notification.routes.js';
import analyticsRoutes from '#routes/analytics.routes.js';
import customerRoutes from '#routes/customer.routes.js';
import reconciliationRoutes from '#routes/reconciliation.routes.js';
import auditRoutes from '#routes/audit.routes.js';
import offlineRoutes from '#routes/offline.routes.js';
import googleSheetsRoutes from '#routes/googleSheets.routes.js';
import { attachUserIfPresent } from '#middleware/auth.middleware.js';
import {
  globalErrorHandler,
  notFoundHandler,
} from '#middleware/errorHandler.middleware.js';
import {
  securityHeaders,
  hppProtection,
  bodyValidator,
  responseHeaderSanitization,
  cookieSecurity,
  suspiciousActivityLogger,
} from '#middleware/xss.middleware.js';

const app = express();

// ============ SECURITY & MIDDLEWARE ============

// Helmet with CSP for security headers (run first)
app.use(securityHeaders);

// HPP protection - prevent HTTP Parameter Pollution
app.use(hppProtection);

// CORS — restrict to allowed origins only
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3000', 'http://localhost:8081'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser
app.use(cookieParser());

// Optionally attach user early so global security middleware can
// apply role-aware rules when token is present.
app.use(attachUserIfPresent);

// XSS and injection attack logging
app.use(suspiciousActivityLogger);

// Sanitize all incoming data (query, body, params)
app.use(bodyValidator);

// Cookie security enhancements
app.use(cookieSecurity);

// HTTP request logging
app.use(
  morgan('combined', {
    stream: { write: message => logger.info(message.trim()) },
  })
);

// Response header sanitization
app.use(responseHeaderSanitization);

// Rate limiting & bot detection
app.use(securityMiddleware);

// ============ HEALTH CHECKS ============

app.get('/', (req, res) => {
  logger.info('Hello from PAYME!');
  res.status(200).send('Hello from PAYME!');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

app.get('/api', (req, res) => {
  res.status(200).json({
    message: 'PAYME API is running!',
    version: '1.0.0',
    docs: 'https://github.com/Hamis254/payme#readme',
  });
});

// ============ API ROUTES ============

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/businesses', businessesRoutes);
// NOTE: /api/setting alias removed — use /api/businesses exclusively
app.use('/api/payment-config', paymentConfigRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/payme', paymeRoutes);
app.use('/api/credit', creditRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/wallet-payment', walletPaymentRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/my-wallet', myWalletRoutes);
app.use('/api/spoiled-stock', spoiledStockRoutes);
app.use('/api/hire-purchase', hirePurchaseRoutes);
app.use('/api/verify', statementVerificationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/offline', offlineRoutes);
app.use('/api/google-sheets', googleSheetsRoutes);

// ============ ERROR HANDLING ============

// 404 handler (must be before global error handler)
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(globalErrorHandler);

export default app;
