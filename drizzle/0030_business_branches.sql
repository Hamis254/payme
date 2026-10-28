CREATE TABLE "branch_approval_otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_business_id" integer NOT NULL,
	"main_business_id" integer NOT NULL,
	"otp_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "business_code" varchar(32);--> statement-breakpoint
-- Backfill existing rows as main businesses. The prefix is the same rule as
-- utils/businessCode.js (first 3 letters of the name, else 'BIZ'). The
-- digits come from the row id, which is unique, so the codes are unique too.
UPDATE "businesses" SET "business_code" = COALESCE(NULLIF(UPPER(LEFT(REGEXP_REPLACE("name", '[^A-Za-z]', '', 'g'), 3)), ''), 'BIZ') || LPAD("id"::text, 4, '0') WHERE "business_code" IS NULL;--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "business_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "is_main" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "parent_business_id" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "branch_sequence" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "branch_status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "branch_approval_otps" ADD CONSTRAINT "branch_approval_otps_branch_business_id_businesses_id_fk" FOREIGN KEY ("branch_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_approval_otps" ADD CONSTRAINT "branch_approval_otps_main_business_id_businesses_id_fk" FOREIGN KEY ("main_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_branch_approval_otps_branch" ON "branch_approval_otps" USING btree ("branch_business_id");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_parent_business_id_businesses_id_fk" FOREIGN KEY ("parent_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_businesses_parent_branch_sequence" ON "businesses" USING btree ("parent_business_id","branch_sequence");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_business_code_unique" UNIQUE("business_code");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_branch_shape_check" CHECK ((is_main AND parent_business_id IS NULL AND branch_sequence IS NULL)
      OR (NOT is_main AND parent_business_id IS NOT NULL AND branch_sequence IS NOT NULL));--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_branch_status_check" CHECK (branch_status IN ('active', 'pending_approval'));