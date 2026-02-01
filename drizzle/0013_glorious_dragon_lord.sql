CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"payment_notifications" boolean DEFAULT true NOT NULL,
	"stock_notifications" boolean DEFAULT true NOT NULL,
	"sales_notifications" boolean DEFAULT true NOT NULL,
	"wallet_notifications" boolean DEFAULT true NOT NULL,
	"credit_notifications" boolean DEFAULT true NOT NULL,
	"expense_notifications" boolean DEFAULT true NOT NULL,
	"daily_summary" boolean DEFAULT false NOT NULL,
	"sms_phone" varchar(20),
	"quiet_hours_enabled" boolean DEFAULT false NOT NULL,
	"quiet_start" varchar(5),
	"quiet_end" varchar(5),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"sms_template" text NOT NULL,
	"email_subject" varchar(255) NOT NULL,
	"email_template" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"channel" varchar(20) DEFAULT 'in_app' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"related_id" integer,
	"related_type" varchar(50),
	"metadata" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"sms_sent" boolean DEFAULT false NOT NULL,
	"sms_error" text,
	"email_sent" boolean DEFAULT false NOT NULL,
	"email_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;