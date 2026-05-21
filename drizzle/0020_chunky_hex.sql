ALTER TABLE "stock_movements" ADD COLUMN "batch_id" integer;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "remaining_quantity" numeric(12, 3);