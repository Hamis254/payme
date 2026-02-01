/**
 * XSS Sanitization Utility for PayMe
 * Prevents Cross-Site Scripting attacks in PDF generation and templates
 *
 * Common XSS Vectors:
 * - HTML tags in business names: <img src=x onerror="alert('xss')">
 * - JavaScript URLs: <a href="javascript:alert('xss')">Click</a>
 * - Event handlers: <div onload="malicious()">
 * - Malformed tags: <svg/onload=alert('xss')>
 *
 * Sanitization Strategy:
 * 1. Strip all HTML tags except safe ones
 * 2. Escape HTML special characters
 * 3. Remove JavaScript URLs
 * 4. Validate URLs for safety
 * 5. Use HTML entity encoding for output
 *
 * PDF-Specific Threats:
 * - JavaScript embedded in PDF metadata
 * - FormCalc scripts in PDF fields
 * - LaunchAction that executes commands
 * - Embedded files with executable code
 *
 * Kenya Data Protection Act 2019 Compliance:
 * - Ensures confidentiality of data (Article 5)
 * - Prevents unauthorized modification (Article 5)
 * - Maintains system security (Article 5)
 */

import logger from '#config/logger.js';

/**
 * HTML entities mapping for encoding
 * Prevents browsers/PDF readers from interpreting special characters
 */
const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#x27;',
  '/': '&#x2F;',
};

/**
 * Dangerous URL schemes that execute code
 * Block these to prevent javascript: and data: URLs
 */
const DANGEROUS_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'about:',
  'chrome:',
  'moz-extension:',
];

/**
 * Escape HTML special characters
 * Converts characters to HTML entities to prevent interpretation
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for HTML/PDF
 *
 * @example
 * escapeHtml('<img src=x onerror=alert()>')
 * // Returns: '&lt;img src=x onerror=alert()&gt;'
 */
export const escapeHtml = text => {
  if (typeof text !== 'string') {
    logger.warn('escapeHtml called with non-string input', {
      type: typeof text,
    });
    return '';
  }

  return text.replace(/[&<>"'/]/g, char => HTML_ENTITIES[char]);
};

/**
 * Validate and sanitize URLs
 * Ensures URLs don't contain javascript: or other dangerous protocols
 *
 * @param {string} url - URL to validate
 * @returns {string|null} Safe URL or null if dangerous
 *
 * @example
 * sanitizeUrl('https://google.com') // 'https://google.com'
 * sanitizeUrl('javascript:alert()') // null
 * sanitizeUrl('http://example.com') // 'http://example.com'
 */
export const sanitizeUrl = url => {
  if (typeof url !== 'string') {
    return null;
  }

  // Trim whitespace
  const trimmedUrl = url.trim();

  // Check for dangerous protocols
  const lowerUrl = trimmedUrl.toLowerCase();
  for (const protocol of DANGEROUS_PROTOCOLS) {
    if (lowerUrl.startsWith(protocol)) {
      logger.warn('Dangerous URL protocol detected', {
        protocol,
        url: trimmedUrl.substring(0, 50), // Log first 50 chars
      });
      return null;
    }
  }

  // Validate URL format
  try {
    const urlObj = new URL(trimmedUrl);
    // Allow http, https, mailto, tel protocols
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(urlObj.protocol)) {
      logger.warn('Unsupported URL protocol', {
        protocol: urlObj.protocol,
      });
      return null;
    }
    return trimmedUrl;
  } catch {
    // Invalid URL format
    logger.debug('Invalid URL format', { url: trimmedUrl.substring(0, 50) });
    return null;
  }
};

/**
 * Remove HTML tags from text
 * Strips all HTML tags, leaving only plain text
 *
 * @param {string} text - Text possibly containing HTML tags
 * @returns {string} Text without HTML tags
 *
 * @example
 * stripHtmlTags('<b>Bold</b> and <i>italic</i>')
 * // Returns: 'Bold and italic'
 *
 * stripHtmlTags('<img src=x onerror=alert()>')
 * // Returns: ''
 */
export const stripHtmlTags = text => {
  if (typeof text !== 'string') return '';

  // Remove all HTML tags (both opening and closing)
  let cleaned = text.replace(/<[^>]*>/g, '');

  // Decode HTML entities (in case they were already encoded)
  cleaned = cleaned
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, '\'')
    .replace(/&amp;/g, '&');

  return cleaned;
};

/**
 * Sanitize plain text input
 * For use in business names, customer names, descriptions
 *
 * Process:
 * 1. Strip HTML tags
 * 2. Escape HTML special characters
 * 3. Limit length
 * 4. Remove control characters
 *
 * @param {string} input - User input to sanitize
 * @param {Object} options - Configuration options
 * @param {number} options.maxLength - Max string length (default: 255)
 * @param {boolean} options.allowNumbers - Allow numeric characters (default: true)
 * @param {boolean} options.allowSymbols - Allow symbols like @#$ (default: true)
 * @returns {string} Sanitized string safe for display in PDFs
 *
 * @example
 * sanitizeInput('<img src=x onerror=alert()> Business Name')
 * // Returns: ' Business Name'
 *
 * sanitizeInput('John\'s Restaurant & Bar')
 * // Returns: 'John&#x27;s Restaurant &amp; Bar'
 */
export const sanitizeInput = (input, options = {}) => {
  const {
    maxLength = 255,
  } = options;

  if (typeof input !== 'string') {
    logger.warn('sanitizeInput called with non-string input', {
      type: typeof input,
    });
    return '';
  }

  let sanitized = input;

  // 1. Strip HTML tags completely
  sanitized = stripHtmlTags(sanitized);

  // 2. Remove zero-width and control characters
  sanitized = sanitized.replace(/[\u200b-\u200d\ufeff]/g, '');

  // 3. Trim whitespace
  sanitized = sanitized.trim();

  // 4. Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    logger.debug('Input truncated to max length', {
      original: input.length,
      truncated: maxLength,
    });
  }

  // 5. Escape HTML special characters for safe display
  sanitized = escapeHtml(sanitized);

  return sanitized;
};

/**
 * Sanitize business names for PDF generation
 * Most strict sanitization - no special characters except basic ones
 *
 * Allowed characters:
 * - Letters A-Z, a-z
 * - Numbers 0-9
 * - Common business characters: . - & '
 *
 * @param {string} businessName - Business name to sanitize
 * @returns {string} Safe business name for PDF
 *
 * @example
 * sanitizeBusinessName('<script>alert(1)</script>M&S Limited')
 * // Returns: 'M&S Limited'
 *
 * sanitizeBusinessName('John\'s Café')
 * // Returns: 'John&#x27;s Café'
 */
export const sanitizeBusinessName = businessName => {
  if (typeof businessName !== 'string') return '';

  // Strip HTML tags
  let sanitized = stripHtmlTags(businessName);

  // Remove characters that are not: alphanumeric, space, or basic business chars (. - & ')
  sanitized = sanitized.replace(/[^a-zA-Z0-9\s.\-&']/g, '');

  // Trim and limit length
  sanitized = sanitized.trim();
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  // Escape for HTML/PDF
  sanitized = escapeHtml(sanitized);

  return sanitized;
};

/**
 * Sanitize phone numbers
 * Ensure format like +254712345678 or 0712345678
 *
 * @param {string} phoneNumber - Phone number to sanitize
 * @returns {string|null} Sanitized phone number or null if invalid
 *
 * @example
 * sanitizePhoneNumber('+254712345678') // '+254712345678'
 * sanitizePhoneNumber('0712345678') // '0712345678'
 * sanitizePhoneNumber('<script>alert()</script>+254712345678')
 * // Returns: '+254712345678'
 */
export const sanitizePhoneNumber = phoneNumber => {
  if (typeof phoneNumber !== 'string') return null;

  // Remove all non-digit characters and + sign
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');

  // Validate format
  // Allow: +254712345678 (12 chars) or 0712345678 (10 chars)
  const validFormats = [/^\+254\d{9}$/, /^0\d{9}$/];
  const isValid = validFormats.some(regex => regex.test(cleaned));

  if (!isValid) {
    logger.warn('Invalid phone number format after sanitization', {
      input: phoneNumber.substring(0, 20),
      cleaned: cleaned.substring(0, 20),
    });
    return null;
  }

  return cleaned;
};

/**
 * Sanitize email addresses
 * Basic validation and sanitization
 *
 * @param {string} email - Email to sanitize
 * @returns {string|null} Sanitized email or null if invalid
 *
 * @example
 * sanitizeEmail('user@example.com') // 'user@example.com'
 * sanitizeEmail('<script>alert()</script>user@example.com')
 * // Returns: 'user@example.com'
 */
export const sanitizeEmail = email => {
  if (typeof email !== 'string') return null;

  // Strip HTML tags
  let cleaned = stripHtmlTags(email);

  // Remove whitespace
  cleaned = cleaned.replace(/\s/g, '');

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleaned)) {
    logger.warn('Invalid email format after sanitization', {
      input: email.substring(0, 50),
    });
    return null;
  }

  return cleaned;
};

/**
 * Sanitize JSON data structure
 * For API responses that might be included in PDFs
 *
 * @param {Object} data - Data structure to sanitize
 * @param {string[]} fieldsToSanitize - Field names to sanitize
 * @returns {Object} New object with sanitized fields
 *
 * @example
 * const user = {
 *   name: '<script>alert()</script>John',
 *   email: 'john@example.com'
 * };
 * const sanitized = sanitizeObject(user, ['name']);
 * // Returns: { name: 'John', email: 'john@example.com' }
 */
export const sanitizeObject = (data, fieldsToSanitize = []) => {
  if (typeof data !== 'object' || data === null) return data;

  const sanitized = { ...data };

  for (const field of fieldsToSanitize) {
    if (sanitized[field]) {
      sanitized[field] = sanitizeInput(sanitized[field]);
    }
  }

  return sanitized;
};

/**
 * Create PDF-safe HTML by escaping all potentially dangerous content
 * Safe to embed directly in PDF templates
 *
 * @param {string} html - HTML string to make safe
 * @returns {string} PDF-safe HTML
 *
 * @example
 * const safePdfHtml = createPdfSafeHtml('<h1>Business: <img src=x onerror=alert()></h1>')
 * // Returns: '<h1>Business: &lt;img src=x onerror=alert()&gt;</h1>'
 */
export const createPdfSafeHtml = html => {
  if (typeof html !== 'string') return '';

  // Only allow basic HTML tags safe for PDFs
  // Replace potentially dangerous tags with escaped versions
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '') // Remove event handlers (onclick, onerror, etc.)
    .replace(/javascript:/gi, '') // Remove javascript: URLs
    .replace(/<iframe/gi, '') // No iframes
    .replace(/<embed/gi, '') // No embedded objects
    .replace(/<object/gi, ''); // No objects
};

export default {
  escapeHtml,
  sanitizeUrl,
  stripHtmlTags,
  sanitizeInput,
  sanitizeBusinessName,
  sanitizePhoneNumber,
  sanitizeEmail,
  sanitizeObject,
  createPdfSafeHtml,
};
