ALTER TABLE "token_purchases" ALTER COLUMN "tokens_purchased" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "wallet_transactions" ALTER COLUMN "change_tokens" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "balance_tokens" SET DATA TYPE numeric(12, 2);
