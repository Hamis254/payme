ALTER TABLE "credit_accounts" DROP CONSTRAINT "credit_accounts_business_id_businesses_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_account_id_credit_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_payments" DROP CONSTRAINT "credit_payments_account_id_credit_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_sales" DROP CONSTRAINT "credit_sales_account_id_credit_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_accounts" ALTER COLUMN "credit_limit" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "credit_accounts" ALTER COLUMN "balance_due" SET DEFAULT '0';