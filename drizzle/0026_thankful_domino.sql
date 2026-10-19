CREATE TABLE "hire_purchase_installment_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"installment_id" integer,
	"payment_type" varchar(20) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" varchar(20),
	"mpesa_transaction_id" varchar(128),
	"cost_recovered" numeric(12, 2) DEFAULT '0' NOT NULL,
	"profit_realized" numeric(12, 2) DEFAULT '0' NOT NULL,
	"payment_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_payments" ADD COLUMN "cost_recovered" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_payments" ADD COLUMN "profit_realized" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "reserved_quantity" numeric(12, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "hire_purchase_installment_payments" ADD CONSTRAINT "hire_purchase_installment_payments_agreement_id_hire_purchase_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."hire_purchase_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_purchase_installment_payments" ADD CONSTRAINT "hire_purchase_installment_payments_installment_id_hire_purchase_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."hire_purchase_installments"("id") ON DELETE set null ON UPDATE no action;