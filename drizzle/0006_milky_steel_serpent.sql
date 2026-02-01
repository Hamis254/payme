ALTER TABLE "businesses" ADD COLUMN "google_sheets_spreadsheet_id" varchar(255);--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "google_sheets_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "google_sheets_auth_token" text;