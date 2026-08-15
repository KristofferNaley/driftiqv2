CREATE TABLE "lead_activities" (
	"id" varchar PRIMARY KEY NOT NULL,
	"lead_id" varchar NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"actor_name" varchar,
	"actor_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "next_action" varchar;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "next_date" date;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;