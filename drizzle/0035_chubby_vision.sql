CREATE TABLE "safety_round_checklist_items" (
	"id" varchar PRIMARY KEY NOT NULL,
	"checklist_id" varchar NOT NULL,
	"text" varchar NOT NULL,
	"section" varchar,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_round_checklists" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "safety_round_items" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_rounds" ADD COLUMN "checklist_id" varchar;--> statement-breakpoint
ALTER TABLE "safety_round_checklist_items" ADD CONSTRAINT "safety_round_checklist_items_checklist_id_safety_round_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."safety_round_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_round_checklists" ADD CONSTRAINT "safety_round_checklists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_rounds" ADD CONSTRAINT "safety_rounds_checklist_id_safety_round_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."safety_round_checklists"("id") ON DELETE set null ON UPDATE no action;