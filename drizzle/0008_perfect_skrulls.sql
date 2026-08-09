CREATE TABLE "units" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"type" varchar DEFAULT 'bolig' NOT NULL,
	"navn" varchar,
	"beskrivelse" text,
	"andelsnr" varchar,
	"leilighetsnr" varchar,
	"oppgang" varchar,
	"etasje" varchar,
	"areal_m2" numeric(10, 2),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;