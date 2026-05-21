CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"user_id" integer,
	"request_body" jsonb,
	"response_status" integer,
	"response_body" jsonb,
	"status" varchar(20) DEFAULT 'processing' NOT NULL,
	"accessed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "unit_cost" SET DATA TYPE numeric(12, 4);--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "unit_cost" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "profit" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "product_name" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_idempotency_key_unique" ON "idempotency_keys" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_idempotency_expires_at" ON "idempotency_keys" USING btree ("expires_at");