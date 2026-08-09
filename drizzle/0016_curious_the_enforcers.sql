CREATE TABLE "routine_steps" (
	"id" varchar PRIMARY KEY NOT NULL,
	"routine_id" varchar NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"is_critical" boolean DEFAULT false NOT NULL,
	"callout_type" varchar,
	"callout_text" text
);
--> statement-breakpoint
CREATE TABLE "routine_versions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"routine_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"version_number" integer NOT NULL,
	"content_snapshot" text NOT NULL,
	"changed_by" varchar NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"category" varchar,
	"responsible" varchar,
	"applies_to" varchar,
	"is_critical" boolean DEFAULT false NOT NULL,
	"review_interval_months" integer DEFAULT 12,
	"status" varchar DEFAULT 'utkast' NOT NULL,
	"last_reviewed_at" date,
	"version" integer DEFAULT 1 NOT NULL,
	"qr_token" varchar,
	"vendor_id" varchar,
	"contract_id" varchar,
	"document_id" varchar,
	"task_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routines_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "hms_template_categories" (
	"id" varchar PRIMARY KEY NOT NULL,
	"template_id" varchar,
	"template_type" varchar NOT NULL,
	"key" varchar NOT NULL,
	"label" varchar NOT NULL,
	"icon" varchar,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hms_template_items" (
	"id" varchar PRIMARY KEY NOT NULL,
	"category_id" varchar NOT NULL,
	"text" varchar NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hms_templates" (
	"id" varchar PRIMARY KEY NOT NULL,
	"template_type" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routine_steps" ADD CONSTRAINT "routine_steps_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_versions" ADD CONSTRAINT "routine_versions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_versions" ADD CONSTRAINT "routine_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_template_categories" ADD CONSTRAINT "hms_template_categories_template_id_hms_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."hms_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_template_items" ADD CONSTRAINT "hms_template_items_category_id_hms_template_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."hms_template_categories"("id") ON DELETE cascade ON UPDATE no action;