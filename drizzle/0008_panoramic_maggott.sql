CREATE TABLE "spoiled_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity_spoiled" numeric(12, 3) NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"total_loss_value" numeric(14, 2) NOT NULL,
	"spoilage_type" varchar(50) NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"reference_type" varchar(50),
	"reference_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "category" SET DATA TYPE varchar(30);--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "currency" varchar(3) DEFAULT 'KES' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payment_reference" varchar(128);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payment_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payment_date" date;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "status" varchar(20) DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "verified_by" integer;--> statement-breakpoint
ALTER TABLE "spoiled_stock" ADD CONSTRAINT "spoiled_stock_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spoiled_stock" ADD CONSTRAINT "spoiled_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spoiled_stock_business_idx" ON "spoiled_stock" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "spoiled_stock_product_idx" ON "spoiled_stock" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "spoiled_stock_type_idx" ON "spoiled_stock" USING btree ("spoilage_type");--> statement-breakpoint
CREATE INDEX "spoiled_stock_date_idx" ON "spoiled_stock" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "mpesa_transaction_id";--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "mpesa_phone";