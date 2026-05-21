-- Add remaining_quantity to stock_movements to support FIFO deductions
ALTER TABLE "stock_movements" ADD COLUMN "remaining_quantity" numeric(12,3);

-- Backfill existing purchase movements so current stock balances are preserved
UPDATE "stock_movements"
SET "remaining_quantity" = "quantity_change"
WHERE "type" = 'purchase' AND "remaining_quantity" IS NULL;
