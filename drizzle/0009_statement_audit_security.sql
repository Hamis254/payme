-- Migration: Add Statement Audit Logs for Security Enhancement
-- Purpose: Store verification codes, SHA-256 fingerprints, and tamper detection
-- Date: 2026-01-28
-- Version: 0009_statement_audit_logs

-- ============ CREATE STATEMENT AUDIT LOGS TABLE ============
CREATE TABLE IF NOT EXISTS statement_audit_logs (
  id SERIAL PRIMARY KEY,

  -- Business reference
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- 9-character verification code (ABC-DEF-GHI format)
  verification_code VARCHAR(11) NOT NULL UNIQUE,

  -- SHA-256 hash of transaction data
  sha256_fingerprint VARCHAR(64) NOT NULL COMMENT 'If amount changes, hash breaks',

  -- Individual transaction hashes for tamper detection
  transaction_data_hash JSONB NOT NULL,

  -- Statement period
  statement_start_date TIMESTAMP NOT NULL,
  statement_end_date TIMESTAMP NOT NULL,
  record_count INTEGER NOT NULL,

  -- PDF security metadata
  pdf_metadata JSONB COMMENT 'Encryption status, permissions, read-only flag',

  -- QR code URL
  qr_verification_url VARCHAR(512) NOT NULL COMMENT 'URL encoded in QR code',

  -- Verification tracking
  is_verified INTEGER DEFAULT 0,
  verification_timestamp TIMESTAMP,
  verification_ip VARCHAR(45),
  verification_user_agent TEXT,

  -- Issuing officer details
  issued_by_user_id INTEGER,
  issued_by_email VARCHAR(255),

  -- Fraud detection
  is_suspicious INTEGER DEFAULT 0,
  suspension_reason TEXT,

  -- Audit timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  -- Indexes for fast lookups
  INDEX idx_verification_code (verification_code),
  INDEX idx_business_id (business_id),
  INDEX idx_created_at (created_at)
);

-- ============ CREATE STATEMENT VERIFICATION CHECKS TABLE ============
CREATE TABLE IF NOT EXISTS statement_verification_checks (
  id SERIAL PRIMARY KEY,

  -- Link to audit log
  statement_audit_id INTEGER NOT NULL REFERENCES statement_audit_logs(id) ON DELETE CASCADE,

  -- Quick code lookup
  verification_code VARCHAR(11) NOT NULL,

  -- Verification device info
  verification_ip VARCHAR(45) NOT NULL,
  user_agent TEXT,
  device_fingerprint VARCHAR(64),

  -- Fingerprint comparison result
  fingerprint_matched INTEGER NOT NULL COMMENT '1 = match, 0 = FRAUD',
  stored_fingerprint VARCHAR(64) NOT NULL,
  provided_fingerprint VARCHAR(64),

  -- Bank officer details
  verified_by_email VARCHAR(255),
  verified_by_bank VARCHAR(100),

  -- Audit timestamp
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  -- Indexes
  INDEX idx_statement_audit_id (statement_audit_id),
  INDEX idx_verification_code (verification_code),
  INDEX idx_created_at (created_at),
  INDEX idx_fingerprint_matched (fingerprint_matched)
);

-- ============ CREATE AUDIT INDEX FOR FRAUD DETECTION ============
-- Query to find all suspicious statements
CREATE INDEX IF NOT EXISTS idx_audit_suspicious ON statement_audit_logs(is_suspicious, created_at);

-- Query to find all verified statements
CREATE INDEX IF NOT EXISTS idx_audit_verified ON statement_audit_logs(is_verified, created_at);

-- ============ SECURITY TRIGGERS ============
-- Auto-update the updated_at timestamp
DELIMITER //

CREATE TRIGGER IF NOT EXISTS update_audit_timestamp
BEFORE UPDATE ON statement_audit_logs
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP;
END //

DELIMITER ;

-- ============ COMMENTS FOR DOCUMENTATION ============
ALTER TABLE statement_audit_logs COMMENT = 
'Immutable audit trail for all statement generations.
 Stores SHA-256 fingerprints to detect document tampering.
 When QR code is scanned, verification_code is looked up here.';

ALTER TABLE statement_verification_checks COMMENT = 
'Detailed log of each QR code scan/verification attempt.
 Compares stored fingerprint with provided fingerprint to detect fraud.
 If fingerprint_matched = 0, the document has been tampered with.';
