-- Add unique constraints for M-Pesa transaction tracking (prevents duplicate processing)
ALTER TABLE "sales" ADD CONSTRAINT "sales_stk_request_id_unique" UNIQUE ("stk_request_id");
ALTER TABLE "sales" ADD CONSTRAINT "sales_mpesa_transaction_id_unique" UNIQUE ("mpesa_transaction_id");

-- Add index for faster M-Pesa callback lookups
CREATE INDEX "idx_sales_stk_request_id" ON "sales" ("stk_request_id");
CREATE INDEX "idx_sales_mpesa_transaction_id" ON "sales" ("mpesa_transaction_id");

-- Token purchases idempotency
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_stk_request_id_unique" UNIQUE ("stk_request_id");
CREATE INDEX "idx_token_purchases_stk_request_id" ON "token_purchases" ("stk_request_id");

-- Credit payments idempotency
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_mpesa_transaction_id_unique" UNIQUE ("mpesa_transaction_id");
CREATE INDEX "idx_credit_payments_mpesa_transaction_id" ON "credit_payments" ("mpesa_transaction_id");

-- Add version column to stock_batches for optimistic locking (prevent race conditions)
ALTER TABLE "stock_batches" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;

-- Add processed flag to callbacks for idempotency
ALTER TABLE "sales" ADD COLUMN "callback_processed" boolean DEFAULT false NOT NULL;
ALTER TABLE "token_purchases" ADD COLUMN "callback_processed" boolean DEFAULT false NOT NULL;

-- Add index for fast lookup of unprocessed callbacks
CREATE INDEX "idx_sales_callback_pending" ON "sales" ("stk_request_id") WHERE "callback_processed" = false;
CREATE INDEX "idx_token_purchases_callback_pending" ON "token_purchases" ("stk_request_id") WHERE "callback_processed" = false;

-- Add wallet transaction reference for tracking (for idempotency)
ALTER TABLE "wallet_transactions" ADD COLUMN "idempotency_key" varchar(128);
CREATE UNIQUE INDEX "idx_wallet_transactions_idempotency" ON "wallet_transactions" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- Add timestamp for soft-delete/archival (not truly deleting, marking as archived)
ALTER TABLE "sales" ADD COLUMN "archived_at" timestamp;
ALTER TABLE "token_purchases" ADD COLUMN "archived_at" timestamp;

-- Performance indexes for common queries
CREATE INDEX "idx_sales_business_created" ON "sales" ("business_id", "created_at" DESC);
CREATE INDEX "idx_token_purchases_business_status" ON "token_purchases" ("business_id", "status");
CREATE INDEX "idx_wallet_transactions_business" ON "wallet_transactions" ("business_id", "created_at" DESC);
CREATE INDEX "idx_stock_movements_product" ON "stock_movements" ("product_id", "created_at" DESC);
CREATE INDEX "idx_credit_accounts_business" ON "credit_accounts" ("business_id", "is_active");
