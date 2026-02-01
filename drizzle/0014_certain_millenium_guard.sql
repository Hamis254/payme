CREATE TABLE "analytics_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"metric_name" varchar(100) NOT NULL,
	"period" varchar(20) NOT NULL,
	"period_date" date NOT NULL,
	"metric_value" numeric(15, 2) NOT NULL,
	"comparison_previous" numeric(15, 2),
	"change_percent" numeric(8, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"customer_phone" varchar(20),
	"total_purchases" integer DEFAULT 0 NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT 0 NOT NULL,
	"avg_transaction_value" numeric(12, 2) DEFAULT 0,
	"last_purchase_date" date,
	"first_purchase_date" date,
	"days_since_last_purchase" integer,
	"is_repeat_customer" integer DEFAULT 0,
	"repeat_frequency" varchar(20),
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"period" varchar(20) NOT NULL,
	"period_date" date NOT NULL,
	"units_sold" numeric(12, 3) DEFAULT 0 NOT NULL,
	"total_revenue" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total_profit" numeric(12, 2) DEFAULT 0 NOT NULL,
	"rank_by_revenue" integer,
	"rank_by_profit" integer,
	"rank_by_units" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_breakdown" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"period" varchar(20) NOT NULL,
	"period_date" date NOT NULL,
	"payment_method" varchar(50),
	"customer_type" varchar(50),
	"total_revenue" numeric(12, 2) DEFAULT 0 NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"avg_transaction" numeric(12, 2) DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_cache" ADD CONSTRAINT "analytics_cache_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_analytics" ADD CONSTRAINT "customer_analytics_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_analytics" ADD CONSTRAINT "product_analytics_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_breakdown" ADD CONSTRAINT "revenue_breakdown_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;