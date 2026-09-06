ALTER TABLE "easee_chargers" ADD COLUMN "latest_pulse" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "easee_chargers" ADD COLUMN "error_code" integer;--> statement-breakpoint
ALTER TABLE "easee_chargers" ADD COLUMN "reason_for_no_current" integer;