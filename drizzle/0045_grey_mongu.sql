ALTER TABLE "parking_leases" DROP CONSTRAINT "parking_leases_spot_id_unique";--> statement-breakpoint
ALTER TABLE "parking_leases" ADD COLUMN "power_billing" varchar;--> statement-breakpoint
ALTER TABLE "parking_leases" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "has_charger" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "charger_label" varchar;--> statement-breakpoint
ALTER TABLE "parking_waitlist" ADD COLUMN "unit_label" varchar;--> statement-breakpoint
-- Datamigrering: «lading» var en plasstype i v1, men er en egenskap — en HC-plass kan ha
-- lader. Eksisterende ladeplasser blir standardplasser MED ladepunkt.
UPDATE "parking_spots" SET "has_charger" = true, "spot_type" = 'standard' WHERE "spot_type" = 'lading';
