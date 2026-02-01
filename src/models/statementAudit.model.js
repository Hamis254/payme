/**
 * =============================================================================
 * MODEL: STATEMENT AUDIT LOGS
 * =============================================================================
 * Stores every statement generation event with verification codes, fingerprints,
 * and transaction hashes for bank-grade security and fraud detection.
 *
 * @module models/statementAudit
 * =============================================================================
 */

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import { businesses } from '#models/setting.model.js';

/**
 * statement_audit_logs
 * 
 * Core audit log for statement generation with cryptographic fingerprinting
 * - verification_code: 9-character code (ABC-DEF-GHI) used for QR verification
 * - sha256_fingerprint: Hash of transaction data at creation—if amount changes, hash breaks
 * - transaction_data_hash: Individual hashes of each transaction for tamper detection
 * - pdf_metadata: Permissions, encryption status, read-only flag
 * - qr_verification_url: The URL that was encoded in the QR code
 * - is_verified: Set to true when QR code is scanned and hash matches
 * - verification_timestamp: When the statement was verified by scanning QR
 * - verification_ip: IP address of the device that scanned the QR code
 */
export const statementAuditLogs = pgTable('statement_audit_logs', {
  id: serial('id').primaryKey(),

  // Business & Session
  business_id: integer('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),

  // Verification Code (9-char format: ABC-DEF-GHI)
  verification_code: varchar('verification_code', { length: 11 }).notNull().unique(),

  // Fingerprints & Hashes
  sha256_fingerprint: varchar('sha256_fingerprint', { length: 64 }).notNull(),

  transaction_data_hash: jsonb('transaction_data_hash').notNull(),

  // Statement Details
  statement_start_date: timestamp('statement_start_date').notNull(),
  statement_end_date: timestamp('statement_end_date').notNull(),
  record_count: integer('record_count').notNull(),

  // PDF Security Metadata
  pdf_metadata: jsonb('pdf_metadata'),

  // QR Code & Verification
  qr_verification_url: varchar('qr_verification_url', { length: 512 }).notNull(),

  // Verification Status (scanned = true when QR code is scanned)
  is_verified: integer('is_verified').default(0).notNull(),
  verification_timestamp: timestamp('verification_timestamp'),
  verification_ip: varchar('verification_ip', { length: 45 }),
  verification_user_agent: text('verification_user_agent'),

  // Issuing Officer Details (for bank audits)
  issued_by_user_id: integer('issued_by_user_id'),
  issued_by_email: varchar('issued_by_email', { length: 255 }),

  // Fraud Detection Fields
  is_suspicious: integer('is_suspicious').default(0),
  suspension_reason: text('suspension_reason'),

  // Timestamps
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * statement_verification_checks
 *
 * Detailed log of each verification attempt (scanned QR codes)
 * - Tracks every time a bank officer scans the QR code
 * - Compares current hash with stored fingerprint to detect tampering
 * - Records device/IP info for audit trails
 */
export const statementVerificationChecks = pgTable(
  'statement_verification_checks',
  {
    id: serial('id').primaryKey(),

    // Link to Statement
    statement_audit_id: integer('statement_audit_id')
      .notNull()
      .references(() => statementAuditLogs.id, { onDelete: 'cascade' }),

    // Verification Code (for quick lookup)
    verification_code: varchar('verification_code', { length: 11 }).notNull(),

    // Verification Details
    verification_ip: varchar('verification_ip', { length: 45 }).notNull(),
    user_agent: text('user_agent'),
    device_fingerprint: varchar('device_fingerprint', { length: 64 }),

    // Verification Result
    fingerprint_matched: integer('fingerprint_matched').notNull(), // 1 = match, 0 = mismatch (FRAUD!)
    stored_fingerprint: varchar('stored_fingerprint', { length: 64 }).notNull(),
    provided_fingerprint: varchar('provided_fingerprint', { length: 64 }),

    // Bank Officer Details (if authenticated)
    verified_by_email: varchar('verified_by_email', { length: 255 }),
    verified_by_bank: varchar('verified_by_bank', { length: 100 }),

    // Audit
    created_at: timestamp('created_at').defaultNow().notNull(),
  }
);

export default {
  statementAuditLogs,
  statementVerificationChecks,
};
