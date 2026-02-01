CREATE TABLE "record_items" (
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
--> statement-breakpoint
CREATE TABLE "records" (
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
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_mpesa_transaction" UNIQUE("business_id","mpesa_transaction_id"),
	CONSTRAINT "unique_reference_id" UNIQUE("business_id","reference_id")
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
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
	"expires_at" timestamp,
	CONSTRAINT "unique_verification_code" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "idx_record_items_record" ON "record_items" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "idx_record_items_product" ON "record_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_records_business_id" ON "records" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "idx_records_type_business" ON "records" USING btree ("type","business_id");--> statement-breakpoint
CREATE INDEX "idx_records_date_business" ON "records" USING btree ("transaction_date","business_id");--> statement-breakpoint
CREATE INDEX "idx_records_payment_method" ON "records" USING btree ("payment_method");--> statement-breakpoint
CREATE INDEX "idx_records_callback_pending" ON "records" USING btree ("callback_processed");--> statement-breakpoint
CREATE INDEX "idx_records_mpesa_id" ON "records" USING btree ("mpesa_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_records_sheets_sync" ON "records" USING btree ("synced_to_sheets");--> statement-breakpoint
CREATE INDEX "idx_verification_codes_business" ON "verification_codes" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "idx_verification_codes_code" ON "verification_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_verification_codes_fingerprint" ON "verification_codes" USING btree ("sha256_fingerprint");