CREATE TABLE "credit_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"credit_limit" numeric(12, 2) DEFAULT 0 NOT NULL,
	"balance_due" numeric(12, 2) DEFAULT 0 NOT NULL,
	"last_payment_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"reference" varchar(255),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "credit_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"sale_id" integer,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"mpesa_transaction_id" varchar(128),
	"stk_request_id" varchar(128),
	"reference" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"callback_payload" text
);
--> statement-breakpoint
CREATE TABLE "credit_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"due_date" timestamp NOT NULL,
	"outstanding_amount" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"description" varchar(255) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"category" varchar(50) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"mpesa_transaction_id" varchar(128),
	"mpesa_phone" varchar(20),
	"expense_date" date NOT NULL,
	"note" text,
	"receipt_url" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hire_purchase_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"principal_amount" numeric(12, 2) NOT NULL,
	"interest_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"down_payment" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_financed" numeric(12, 2) NOT NULL,
	"installment_amount" numeric(12, 2) NOT NULL,
	"installment_frequency" varchar(20) NOT NULL,
	"number_of_installments" integer NOT NULL,
	"installments_paid" integer DEFAULT 0 NOT NULL,
	"agreement_date" date NOT NULL,
	"first_payment_date" date NOT NULL,
	"final_payment_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"balance_remaining" numeric(12, 2) NOT NULL,
	"late_fee_amount" numeric(12, 2) DEFAULT '0',
	"grace_period_days" integer DEFAULT 0,
	"terms_and_conditions" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "hire_purchase_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"installment_number" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_due" numeric(12, 2) NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0',
	"payment_date" date,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payment_method" varchar(20),
	"mpesa_transaction_id" varchar(128),
	"late_fee_charged" numeric(12, 2) DEFAULT '0',
	"days_overdue" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "token_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"package_type" varchar(50) NOT NULL,
	"tokens_purchased" integer NOT NULL,
	"amount_paid" numeric(12, 2) NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"mpesa_transaction_id" varchar(128),
	"mpesa_phone" varchar(20),
	"stk_request_id" varchar(128),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"callback_payload" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"change_tokens" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"reference" varchar(255),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"balance_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"stk_request_id" varchar(128),
	"mpesa_transaction_id" varchar(128),
	"phone" varchar(20),
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"callback_payload" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total_price" numeric(12, 2) NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"profit" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"total_profit" numeric(12, 2) NOT NULL,
	"payment_mode" varchar(20) NOT NULL,
	"token_fee" integer DEFAULT 1 NOT NULL,
	"stk_request_id" varchar(128),
	"mpesa_transaction_id" varchar(128),
	"mpesa_sender_name" varchar(255),
	"mpesa_sender_phone" varchar(20),
	"amount_paid" numeric(12, 2),
	"payment_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"callback_payload" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"customer_type" varchar(20) DEFAULT 'walk_in' NOT NULL,
	"customer_id" integer,
	"customer_name" varchar(255),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(512),
	"sku" varchar(100),
	"unit" varchar(50) NOT NULL,
	"selling_price_per_unit" numeric(12, 2) NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"quantity_purchased" numeric(12, 3) NOT NULL,
	"quantity_remaining" numeric(12, 3) NOT NULL,
	"total_buying_price" numeric(12, 2) NOT NULL,
	"buying_price_per_unit" numeric(12, 2) NOT NULL,
	"selling_price_per_unit" numeric(12, 2) NOT NULL,
	"note" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"batch_id" integer,
	"type" varchar(50) NOT NULL,
	"quantity_change" numeric(12, 3) NOT NULL,
	"unit_cost" numeric(12, 2),
	"reference_type" varchar(50),
	"reference_id" integer,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_sales" ADD CONSTRAINT "credit_sales_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_purchase_agreements" ADD CONSTRAINT "hire_purchase_agreements_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_purchase_agreements" ADD CONSTRAINT "hire_purchase_agreements_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_purchase_agreements" ADD CONSTRAINT "hire_purchase_agreements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_purchase_installments" ADD CONSTRAINT "hire_purchase_installments_agreement_id_hire_purchase_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."hire_purchase_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE set null ON UPDATE no action;