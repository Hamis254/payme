CREATE TABLE "customer_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"note_type" varchar(50),
	"content" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"favorite_products" text,
	"preferred_payment" varchar(50),
	"average_spend" numeric(12, 2) DEFAULT 0,
	"best_contact_time" varchar(100),
	"do_not_contact" boolean DEFAULT false,
	"can_receive_offers" boolean DEFAULT true,
	"can_receive_loyalty" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_purchase_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"business_id" integer NOT NULL,
	"total_purchases" integer DEFAULT 0 NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total_items_bought" numeric(12, 3) DEFAULT 0,
	"avg_transaction_value" numeric(12, 2) DEFAULT 0,
	"first_purchase_date" date,
	"last_purchase_date" date,
	"days_since_last_purchase" integer,
	"is_repeat_customer" boolean DEFAULT false,
	"customer_lifetime_value" numeric(12, 2) DEFAULT 0,
	"repeat_frequency" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"address" text,
	"customer_type" varchar(50) DEFAULT 'walk_in',
	"is_active" boolean DEFAULT true,
	"prefer_sms" boolean DEFAULT true,
	"prefer_email" boolean DEFAULT false,
	"prefer_call" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_purchase_history" ADD CONSTRAINT "customer_purchase_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_purchase_history" ADD CONSTRAINT "customer_purchase_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;