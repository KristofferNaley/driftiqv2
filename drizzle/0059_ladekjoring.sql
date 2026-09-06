CREATE TABLE "charging_run_lines" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"charging_run_id" varchar NOT NULL,
	"unit_id" varchar,
	"owner_id" varchar,
	"owner_name" varchar,
	"owner_email" varchar,
	"unit_label" varchar,
	"description" varchar NOT NULL,
	"issue" varchar,
	"kwh" double precision DEFAULT 0 NOT NULL,
	"kwh_day" double precision DEFAULT 0 NOT NULL,
	"kwh_night" double precision DEFAULT 0 NOT NULL,
	"energy_amount" integer DEFAULT 0 NOT NULL,
	"grid_amount" integer DEFAULT 0 NOT NULL,
	"fixed_amount" integer DEFAULT 0 NOT NULL,
	"amount" integer NOT NULL,
	"order_reference" varchar NOT NULL,
	"external_ref" varchar,
	"external_number" varchar,
	"sent_to_recipient" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging_runs" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar DEFAULT 'grunnlag' NOT NULL,
	"due_date" date NOT NULL,
	"income_account" varchar NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"missing_recipients" integer DEFAULT 0 NOT NULL,
	"total_kwh" double precision DEFAULT 0 NOT NULL,
	"sent_to" varchar,
	"sent_at" timestamp with time zone,
	"created_by" varchar NOT NULL,
	"created_by_user_id" varchar,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charging_run_lines" ADD CONSTRAINT "charging_run_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_run_lines" ADD CONSTRAINT "charging_run_lines_charging_run_id_charging_runs_id_fk" FOREIGN KEY ("charging_run_id") REFERENCES "public"."charging_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_run_lines" ADD CONSTRAINT "charging_run_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_run_lines" ADD CONSTRAINT "charging_run_lines_owner_id_unit_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."unit_owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_runs" ADD CONSTRAINT "charging_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_runs" ADD CONSTRAINT "charging_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_charging_run_lines_run" ON "charging_run_lines" USING btree ("charging_run_id");--> statement-breakpoint
CREATE INDEX "idx_charging_run_lines_unit" ON "charging_run_lines" USING btree ("unit_id");