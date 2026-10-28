CREATE TABLE "token_lot_consumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_transaction_id" integer NOT NULL,
	"lot_id" integer NOT NULL,
	"tokens" numeric(12, 2) NOT NULL,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "token_lot_consumptions_tokens_check" CHECK (tokens > 0)
);
--> statement-breakpoint
CREATE TABLE "token_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"source" varchar(20) NOT NULL,
	"tokens_initial" numeric(12, 2) NOT NULL,
	"tokens_remaining" numeric(12, 2) NOT NULL,
	"expires_at" timestamp,
	"notice_day5_sent_at" timestamp,
	"notice_expiry_sent_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "token_lots_source_check" CHECK (source IN ('trial', 'purchase', 'manual')),
	CONSTRAINT "token_lots_remaining_check" CHECK (tokens_remaining >= 0 AND tokens_remaining <= tokens_initial),
	CONSTRAINT "token_lots_expiry_shape_check" CHECK ((source = 'trial') = (expires_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "token_lot_consumptions" ADD CONSTRAINT "token_lot_consumptions_wallet_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_lot_consumptions" ADD CONSTRAINT "token_lot_consumptions_lot_id_token_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."token_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_lots" ADD CONSTRAINT "token_lots_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_token_lot_consumptions_tx" ON "token_lot_consumptions" USING btree ("wallet_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_token_lots_business" ON "token_lots" USING btree ("business_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_token_lots_trial_once" ON "token_lots" USING btree ("business_id") WHERE source = 'trial';--> statement-breakpoint
-- Existing balances become one non-expiring purchase lot per wallet, so that
-- "balance = sum of live lots" holds from the first run. Existing mains get
-- no trial: trials are granted to new mains only.
INSERT INTO "token_lots" ("business_id", "source", "tokens_initial", "tokens_remaining", "expires_at", "note")
SELECT "business_id", 'purchase', "balance_tokens", "balance_tokens", NULL, 'Legacy balance carried over'
FROM "wallets" WHERE "balance_tokens" > 0;
