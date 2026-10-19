ALTER TABLE "products" ADD COLUMN "reserved_quantity" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" DROP COLUMN "reserved_quantity";