CREATE TABLE "offline_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"offline_mode_enabled" boolean DEFAULT true NOT NULL,
	"auto_sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_interval_minutes" integer DEFAULT 5 NOT NULL,
	"max_queue_size" integer DEFAULT 500 NOT NULL,
	"retry_delay_seconds" integer DEFAULT 30 NOT NULL,
	"default_conflict_strategy" varchar(20) DEFAULT 'client_wins',
	"allow_sales_offline" boolean DEFAULT true NOT NULL,
	"allow_expenses_offline" boolean DEFAULT true NOT NULL,
	"allow_stock_adjustment_offline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offline_config_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "offline_local_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"data_type" varchar(50) NOT NULL,
	"local_id" varchar(100) NOT NULL,
	"server_id" varchar(50),
	"data" jsonb NOT NULL,
	"synced" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"operation_type" varchar(50) NOT NULL,
	"operation_id" varchar(50) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"method" varchar(10) NOT NULL,
	"request_body" jsonb NOT NULL,
	"request_headers" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sync_attempts" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"server_response" jsonb,
	"server_id" varchar(50),
	"conflict_type" varchar(50),
	"conflict_data" jsonb,
	"resolution_strategy" varchar(20),
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"executed_at" timestamp NOT NULL,
	"synced_at" timestamp,
	"failed_at" timestamp,
	"last_error" text,
	"error_code" varchar(20),
	"device_id" varchar(100),
	"sync_batch_id" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "offline_sync_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"queue_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"sync_type" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"server_status" integer,
	"response_data" jsonb,
	"sync_duration_ms" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error_message" text,
	"device_id" varchar(100),
	"network_type" varchar(20)
);
--> statement-breakpoint
ALTER TABLE "offline_config" ADD CONSTRAINT "offline_config_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_local_data" ADD CONSTRAINT "offline_local_data_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_local_data" ADD CONSTRAINT "offline_local_data_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_queue" ADD CONSTRAINT "offline_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_queue" ADD CONSTRAINT "offline_queue_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_history" ADD CONSTRAINT "offline_sync_history_queue_id_offline_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."offline_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_history" ADD CONSTRAINT "offline_sync_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;