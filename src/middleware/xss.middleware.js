import helmet from 'helmet';
import hpp from 'hpp';
import sanitizeHtml from 'sanitize-html';
import xss from 'xss';
import logger from '#config/logger.js';

/**
 * XSS Protection Middleware Stack
 * Provides comprehensive protection against XSS attacks using:
 * - helmet: HTTP headers security
 * - hpp: HTTP Parameter Pollution protection
 * - sanitize-html: HTML sanitization
 * - xss: XSS prevention library
 */

/**
 * Helmet middleware - Sets security HTTP headers
 * - Content Security Policy (CSP)
 * - X-Frame-Options (Clickjacking protection)
 * - X-Content-Type-Options (MIME type sniffing)
 * - Strict-Transport-Security (HTTPS enforcement)
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ['\'self\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      scriptSrc: ['\'self\''],
      imgSrc: ['\'self\'', 'data:', 'https:'],
      fontSrc: ['\'self\''],
      connectSrc: ['\'self\''],
      frameSrc: ['\'none\''],
      baseUri: ['\'self\''],
      formAction: ['\'self\''],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny',
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
});

/**
 * HPP Middleware - HTTP Parameter Pollution protection
 * Prevents attackers from injecting multiple parameters with the same name
 */
export const hppProtection = hpp({
  whitelist: [
    // Whitelist parameters that should allow arrays
    'sort',
    'filter',
    'fields',
  ],
});

/**
 * Sanitize string values in request body
 * @param {string} value - The value to sanitize
 * @returns {string} - Sanitized value
 */
export const sanitizeString = value => {
  if (typeof value !== 'string') return value;

  // Remove XSS attempts with xss library
  let cleaned = xss(value, {
    whiteList: {},
    stripIgnoredTag: true,
    stripLeakingTag: true,
  });

  // Additional sanitization with sanitize-html
  cleaned = sanitizeHtml(cleaned, {
    allowedTags: [],
    allowedAttributes: {},
  });

  return cleaned.trim();
};

/**
 * Deep sanitization of objects recursively
 * @param {*} obj - The object to sanitize
 * @returns {*} - The sanitized object
 */
export const deepSanitize = obj => {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepSanitize(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = deepSanitize(value);
    }
    return sanitized;
  }

  return obj;
};

/**
 * Request body sanitization middleware
 * Sanitizes all incoming request bodies to prevent XSS
 */
export const bodyValidator = (req, res, next) => {
  // Sanitize query parameters. In this Express version req.query is a
  // getter-only property computed from the URL — reassigning it directly
  // (req.query = ...) throws "Cannot set property query of
  // #<IncomingMessage> which has only a getter" on any request with query
  // params. Mutating the object's contents in place avoids that specific
  // crash, wrapped in try/catch as a hard guarantee this can never again
  // take down an entire request with a 500 — worst case, query params
  // just pass through unsanitized for that one request instead of
  // crashing, with a warning logged.
  if (req.query && Object.keys(req.query).length > 0) {
    try {
      const sanitizedQuery = deepSanitize(req.query);
      for (const key of Object.keys(req.query)) {
        delete req.query[key];
      }
      Object.assign(req.query, sanitizedQuery);
    } catch (err) {
      logger.warn('Could not sanitize query params in place — skipping', {
        error: err.message,
        path: req.path,
      });
    }
  }

  // Sanitize body parameters. req.body is a plain writable object set
  // fresh by body-parser on each request, so direct reassignment is safe.
  if (req.body && Object.keys(req.body).length > 0) {
    req.body = deepSanitize(req.body);
  }

  // Sanitize URL parameters. req.params is likewise a plain writable
  // object set fresh by the router per request — safe to reassign.
  if (req.params && Object.keys(req.params).length > 0) {
    req.params = deepSanitize(req.params);
  }

  next();
};

/**
 * Response header sanitization
 * Ensures sensitive information isn't leaked in response headers
 */
export const responseHeaderSanitization = (req, res, next) => {
  // Remove sensitive headers
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');

  // Set safe headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });

  next();
};

/**
 * Cookie security middleware
 * Ensures cookies are set securely
 */
export const cookieSecurity = (req, res, next) => {
  const originalCookie = res.cookie.bind(res);

  res.cookie = function (name, val, options) {
    const cookieOptions = {
      ...options,
      httpOnly: true, // Prevent JS access
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict', // CSRF protection
      maxAge: options?.maxAge || 3600000, // 1 hour default
    };
    return originalCookie(name, val, cookieOptions);
  };

  next();
};

/**
 * Logging for suspicious activity
 */
export const suspiciousActivityLogger = (req, res, next) => {
  // Check for common XSS patterns
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers like onclick=
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<applet/i,
    /base64/i,
  ];

  const checkValue = value => {
    if (typeof value !== 'string') return false;
    return suspiciousPatterns.some(pattern => pattern.test(value));
  };

  const checkObj = obj => {
    if (typeof obj === 'string') return checkValue(obj);
    if (Array.isArray(obj)) return obj.some(item => checkObj(item));
    if (obj && typeof obj === 'object') {
      return Object.values(obj).some(value => checkObj(value));
    }
    return false;
  };

  if (checkObj(req.query) || checkObj(req.body) || checkObj(req.params)) {
    logger.warn('Suspicious XSS-like activity detected', {
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      query: req.query,
      body: req.body,
    });
  }

  next();
};

export default {
  securityHeaders,
  hppProtection,
  sanitizeString,
  deepSanitize,
  bodyValidator,
  responseHeaderSanitization,
  cookieSecurity,
  suspiciousActivityLogger,
};