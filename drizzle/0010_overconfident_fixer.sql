CREATE TABLE "wallet_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"sale_id" integer NOT NULL,
	"amount_ksh" integer NOT NULL,
	"phone" varchar(20) NOT NULL,
	"payment_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"paybill" varchar(10) NOT NULL,
	"account_reference" varchar(50) NOT NULL,
	"mpesa_transaction_id" varchar(128),
	"callback_payload" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_payments" ADD CONSTRAINT "wallet_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_payments" ADD CONSTRAINT "wallet_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;