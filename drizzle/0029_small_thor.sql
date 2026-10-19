CREATE TABLE "mpesa_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"checkout_request_id" varchar(128) NOT NULL,
	"merchant_request_id" varchar(128),
	"phone" varchar(20),
	"amount" numeric(12, 2) NOT NULL,
	"cart_items" text NOT NULL,
	"customer_name" varchar(255),
	"customer_type" varchar(20) DEFAULT 'walk_in' NOT NULL,
	"note" text,
	"stock_reserved" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'initiated' NOT NULL,
	"result_code" integer,
	"result_desc" text,
	"mpesa_receipt" varchar(128),
	"mpesa_sender_phone" varchar(20),
	"amount_paid" numeric(12, 2),
	"callback_payload" text,
	"sale_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "mpesa_attempts" ADD CONSTRAINT "mpesa_attempts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_attempts" ADD CONSTRAINT "mpesa_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mpesa_attempts_checkout_request_id" ON "mpesa_attempts" USING btree ("checkout_request_id");--> statement-breakpoint
CREATE INDEX "idx_mpesa_attempts_status_created" ON "mpesa_attempts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_mpesa_attempts_business" ON "mpesa_attempts" USING btree ("business_id");