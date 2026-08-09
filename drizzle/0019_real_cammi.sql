ALTER TABLE "organizations" ADD COLUMN "building_info" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "has_employees" boolean DEFAULT false NOT NULL;