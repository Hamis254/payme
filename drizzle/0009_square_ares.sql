CREATE TABLE "statement_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"verification_code" varchar(11) NOT NULL,
	"sha256_fingerprint" varchar(64) NOT NULL,
	"transaction_data_hash" jsonb NOT NULL,
	"statement_start_date" timestamp NOT NULL,
	"statement_end_date" timestamp NOT NULL,
	"record_count" integer NOT NULL,
	"pdf_metadata" jsonb,
	"qr_verification_url" varchar(512) NOT NULL,
	"is_verified" integer DEFAULT 0 NOT NULL,
	"verification_timestamp" timestamp,
	"verification_ip" varchar(45),
	"verification_user_agent" text,
	"issued_by_user_id" integer,
	"issued_by_email" varchar(255),
	"is_suspicious" integer DEFAULT 0,
	"suspension_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "statement_audit_logs_verification_code_unique" UNIQUE("verification_code")
);
--> statement-breakpoint
CREATE TABLE "statement_verification_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_audit_id" integer NOT NULL,
	"verification_code" varchar(11) NOT NULL,
	"verification_ip" varchar(45) NOT NULL,
	"user_agent" text,
	"device_fingerprint" varchar(64),
	"fingerprint_matched" integer NOT NULL,
	"stored_fingerprint" varchar(64) NOT NULL,
	"provided_fingerprint" varchar(64),
	"verified_by_email" varchar(255),
	"verified_by_bank" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statement_audit_logs" ADD CONSTRAINT "statement_audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_verification_checks" ADD CONSTRAINT "statement_verification_checks_statement_audit_id_statement_audit_logs_id_fk" FOREIGN KEY ("statement_audit_id") REFERENCES "public"."statement_audit_logs"("id") ON DELETE cascade ON UPDATE no action;