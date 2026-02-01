-- Migration: Records System - Financial Ledger & Revenue Guard
-- Date: 2026-01-27
-- Purpose: Create unified records table for sales, HP, credits, inventory, expenses
--          with Google Sheets sync and verification code tracking

CREATE TABLE IF NOT EXISTS "records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text,
	"amount" numeric(12, 2) NOT NULL,
	"quantity" integer DEFAULT 1,
	"payment_method" varchar(20),
	"mpesa_receipt_number" varchar(50),
	"mpesa_sender_name" varchar(100),
	"mpesa_sender_phone" varchar(20),
	"mpesa_transaction_date" timestamp,
	"mpesa_transaction_id" varchar(100),
	"product_id" integer,
	"stock_batch_id" integer,
	"cost_per_unit" numeric(12, 2),
	"credit_due_date" timestamp,
	"credit_amount_paid" numeric(12, 2) DEFAULT 0,
	"credit_status" varchar(20),
	"token_deducted" integer DEFAULT 1,
	"revenue_guard_reference" varchar(100),
	"synced_to_sheets" boolean DEFAULT false,
	"sheets_row_id" varchar(100),
	"sheets_sync_error" text,
	"callback_processed" boolean DEFAULT false,
	"reference_id" varchar(100),
	"notes" text,
	"transaction_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "record_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "record_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"record_id" integer NOT NULL,
	"item_name" varchar(200) NOT NULL,
	"description" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"product_id" integer,
	"stock_batch_id" integer,
	"cost_per_unit" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"code" varchar(11) NOT NULL,
	"qr_code_url" text,
	"qr_encoded_data" text,
	"statement_start_date" timestamp NOT NULL,
	"statement_end_date" timestamp NOT NULL,
	"statement_total" numeric(14, 2) NOT NULL,
	"sha256_fingerprint" varchar(64) NOT NULL,
	"digital_signature" text,
	"pdf_filename" varchar(255),
	"record_count" integer NOT NULL,
	"used" boolean DEFAULT false,
	"verified_at" timestamp,
	"verified_by" varchar(100),
	"verification_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);

-- Indexes for performance
CREATE INDEX "idx_records_business_id" ON "records" ("business_id");
CREATE INDEX "idx_records_type_business" ON "records" ("type", "business_id");
CREATE INDEX "idx_records_date_business" ON "records" ("transaction_date", "business_id");
CREATE INDEX "idx_records_payment_method" ON "records" ("payment_method");
CREATE INDEX "idx_records_callback_pending" ON "records" ("callback_processed") WHERE "callback_processed" = false;
CREATE INDEX "idx_records_mpesa_id" ON "records" ("mpesa_transaction_id");
CREATE INDEX "idx_records_sheets_sync" ON "records" ("synced_to_sheets") WHERE "synced_to_sheets" = false;

CREATE INDEX "idx_record_items_record" ON "record_items" ("record_id");
CREATE INDEX "idx_record_items_product" ON "record_items" ("product_id");

CREATE INDEX "idx_verification_codes_business" ON "verification_codes" ("business_id");
CREATE INDEX "idx_verification_codes_code" ON "verification_codes" ("code");
CREATE INDEX "idx_verification_codes_fingerprint" ON "verification_codes" ("sha256_fingerprint");

-- Unique constraints for idempotency
ALTER TABLE "records" ADD CONSTRAINT "unique_mpesa_transaction" UNIQUE ("business_id", "mpesa_transaction_id");
ALTER TABLE "records" ADD CONSTRAINT "unique_reference_id" UNIQUE ("business_id", "reference_id");
ALTER TABLE "verification_codes" ADD CONSTRAINT "unique_verification_code" UNIQUE ("code");
