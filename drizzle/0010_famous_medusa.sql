CREATE TABLE "deviation_logs" (
	"id" varchar PRIMARY KEY NOT NULL,
	"deviation_id" varchar NOT NULL,
	"changed_by" varchar NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviation_treatments" (
	"id" varchar PRIMARY KEY NOT NULL,
	"deviation_id" varchar NOT NULL,
	"text" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviations" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"number" integer,
	"task_id" varchar,
	"completion_id" varchar,
	"vendor_id" varchar,
	"unit_id" varchar,
	"title" varchar NOT NULL,
	"description" text,
	"category" varchar,
	"severity" varchar,
	"status" varchar DEFAULT 'ny' NOT NULL,
	"reported_by" varchar NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responsible_user_id" varchar,
	"assigned_to" varchar,
	"due_date" date,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar,
	"resolution_notes" text
);
--> statement-breakpoint
ALTER TABLE "deviation_logs" ADD CONSTRAINT "deviation_logs_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_treatments" ADD CONSTRAINT "deviation_treatments_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;