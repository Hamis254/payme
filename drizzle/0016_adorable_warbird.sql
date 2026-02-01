CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"user_id" integer,
	"user_email" varchar(255),
	"user_role" varchar(50),
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" integer,
	"previous_value" jsonb,
	"new_value" jsonb,
	"changed_fields" jsonb,
	"description" text,
	"reason" text,
	"ip_address" "inet",
	"user_agent" varchar(500),
	"request_id" varchar(100),
	"risk_level" varchar(20) DEFAULT 'low' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_export_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"export_type" varchar(50) NOT NULL,
	"format" varchar(20) NOT NULL,
	"entity_types" jsonb,
	"filters_applied" jsonb,
	"record_count" integer DEFAULT 0 NOT NULL,
	"file_size_bytes" integer,
	"download_url" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(20) NOT NULL,
	"ip_address" "inet",
	"user_agent" varchar(500),
	"city" varchar(100),
	"country" varchar(100),
	"success" integer DEFAULT 1 NOT NULL,
	"failure_reason" varchar(255),
	"session_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensitive_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"action_type" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" integer,
	"amount" numeric(12, 2),
	"requires_approval" integer DEFAULT 0 NOT NULL,
	"approval_status" varchar(20),
	"approved_by" integer,
	"approved_at" timestamp,
	"approval_note" text,
	"performed_by" integer NOT NULL,
	"reason" text NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"reconciliation_date" timestamp NOT NULL,
	"counted_cash" numeric(12, 2) NOT NULL,
	"system_cash" numeric(12, 2) NOT NULL,
	"variance" numeric(12, 2) NOT NULL,
	"variance_percent" numeric(5, 2),
	"variance_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"variance_note" text,
	"performed_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpesa_reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"system_transactions" integer DEFAULT 0 NOT NULL,
	"system_amount" numeric(12, 2) NOT NULL,
	"bank_transactions" integer DEFAULT 0 NOT NULL,
	"bank_amount" numeric(12, 2) NOT NULL,
	"variance_transactions" integer DEFAULT 0 NOT NULL,
	"variance_amount" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"investigation_notes" text,
	"missing_transactions" jsonb,
	"extra_transactions" jsonb,
	"performed_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"cash_variance_threshold" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"mpesa_variance_threshold" numeric(5, 2) DEFAULT '0.50' NOT NULL,
	"daily_reconciliation_required" integer DEFAULT 1 NOT NULL,
	"auto_flag_enabled" integer DEFAULT 1 NOT NULL,
	"supervisor_approval_required" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_config_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_logs" ADD CONSTRAINT "data_export_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_logs" ADD CONSTRAINT "data_export_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_actions" ADD CONSTRAINT "sensitive_actions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_actions" ADD CONSTRAINT "sensitive_actions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_actions" ADD CONSTRAINT "sensitive_actions_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_reconciliations" ADD CONSTRAINT "mpesa_reconciliations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_reconciliations" ADD CONSTRAINT "mpesa_reconciliations_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_config" ADD CONSTRAINT "reconciliation_config_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;