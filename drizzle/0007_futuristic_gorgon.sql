ALTER TABLE "stock_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "stock_batches" CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "current_quantity" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "buying_price_per_unit" numeric(12, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "sku";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "unit";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "batch_id";