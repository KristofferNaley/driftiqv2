CREATE TABLE "deviation_attachments" (
	"id" varchar PRIMARY KEY NOT NULL,
	"deviation_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"treatment_id" varchar,
	"filename" varchar NOT NULL,
	"original_name" varchar NOT NULL,
	"content_type" varchar,
	"file_size" bigint,
	"uploaded_by" varchar NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_messages" (
	"id" varchar PRIMARY KEY NOT NULL,
	"report_id" varchar NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"author_name" varchar NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" varchar PRIMARY KEY NOT NULL,
	"number" integer,
	"org_id" varchar NOT NULL,
	"kind" varchar DEFAULT 'bug' NOT NULL,
	"module" varchar,
	"description" text NOT NULL,
	"status" varchar DEFAULT 'ny' NOT NULL,
	"reported_by_user_id" varchar,
	"reported_by_name" varchar NOT NULL,
	"reported_by_email" varchar,
	"app_version" varchar,
	"user_agent" varchar,
	"in_backlog" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deviation_attachments" ADD CONSTRAINT "deviation_attachments_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_attachments" ADD CONSTRAINT "deviation_attachments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_attachments" ADD CONSTRAINT "deviation_attachments_treatment_id_deviation_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."deviation_treatments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_report_id_feedback_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."feedback_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;