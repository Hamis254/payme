CREATE TABLE "payment_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"shortcode" varchar(20) NOT NULL,
	"passkey" text NOT NULL,
	"account_reference" varchar(12) NOT NULL,
	"account_name" varchar(255),
	"verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_configs" ADD CONSTRAINT "payment_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;