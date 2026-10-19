ALTER TABLE "products" ADD COLUMN "sku" varchar(100);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" varchar(50) DEFAULT 'pcs' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "expiry_date" timestamp;