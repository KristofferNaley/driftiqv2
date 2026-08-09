CREATE TABLE "parking_leases" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"spot_id" varchar NOT NULL,
	"tenant_name" varchar NOT NULL,
	"price_per_month" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"notice_period_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_leases_spot_id_unique" UNIQUE("spot_id")
);
--> statement-breakpoint
CREATE TABLE "parking_spots" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"number" varchar NOT NULL,
	"area_label" varchar,
	"ownership_type" varchar DEFAULT 'felles' NOT NULL,
	"spot_type" varchar DEFAULT 'standard' NOT NULL,
	"status" varchar DEFAULT 'ledig' NOT NULL,
	"holder_name" varchar,
	"unit_label" varchar,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parking_waitlist" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"requested_type" varchar DEFAULT 'standard' NOT NULL,
	"requested_at" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "enabled_modules" text;--> statement-breakpoint
ALTER TABLE "parking_leases" ADD CONSTRAINT "parking_leases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_leases" ADD CONSTRAINT "parking_leases_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spots" ADD CONSTRAINT "parking_spots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_waitlist" ADD CONSTRAINT "parking_waitlist_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;