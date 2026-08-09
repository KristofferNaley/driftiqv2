CREATE TABLE "pricing_config" (
	"id" varchar PRIMARY KEY NOT NULL,
	"floor_price" integer DEFAULT 8000 NOT NULL,
	"tiers" text NOT NULL,
	"module_defaults" text NOT NULL,
	"hidden_modules" text DEFAULT '[]' NOT NULL,
	"leads_notify_emails" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bbl" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"org_nr" varchar,
	"region" varchar,
	"website" varchar,
	"notes" text,
	"successor_id" varchar,
	"merge_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bbl_org_nr_unique" UNIQUE("org_nr")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "affiliation_type" varchar;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "bbl_id" varchar;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "manager_type" varchar;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "manager_bbl_id" varchar;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "manager_name" varchar;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "manager_org_nr" varchar;--> statement-breakpoint
ALTER TABLE "bbl" ADD CONSTRAINT "bbl_successor_id_bbl_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."bbl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_bbl_id_bbl_id_fk" FOREIGN KEY ("bbl_id") REFERENCES "public"."bbl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_manager_bbl_id_bbl_id_fk" FOREIGN KEY ("manager_bbl_id") REFERENCES "public"."bbl"("id") ON DELETE no action ON UPDATE no action;