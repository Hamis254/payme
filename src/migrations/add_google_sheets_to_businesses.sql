-- Add Google Sheets integration columns to businesses table
ALTER TABLE "businesses" ADD COLUMN "google_sheets_spreadsheet_id" varchar(255);
ALTER TABLE "businesses" ADD COLUMN "google_sheets_enabled" boolean DEFAULT false;
ALTER TABLE "businesses" ADD COLUMN "google_sheets_auth_token" text;

-- Create index for quick lookup
CREATE INDEX "idx_businesses_sheets_id" ON "businesses" ("google_sheets_spreadsheet_id");
