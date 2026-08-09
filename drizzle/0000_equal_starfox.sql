CREATE TYPE "public"."accesslevelenum" AS ENUM('orgadmin', 'redigering', 'visning');--> statement-breakpoint
CREATE TYPE "public"."roleenum" AS ENUM('superadmin', 'admin', 'member', 'vendor', 'kontoansvarlig');--> statement-breakpoint
CREATE TYPE "public"."frequencyenum" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'every_3_years', 'every_5_years', 'every_8_years', 'on_demand');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"org_nr" varchar,
	"org_form" varchar,
	"municipality" varchar,
	"unit_count" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_org_nr_unique" UNIQUE("org_nr")
);
--> statement-breakpoint
CREATE TABLE "user_org_memberships" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"role" "accesslevelenum" DEFAULT 'visning' NOT NULL,
	"title" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar,
	"name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar,
	"role" "roleenum" DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"last_login_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" varchar PRIMARY KEY NOT NULL,
	"task_id" varchar NOT NULL,
	"text" varchar NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"responsible_user_id" varchar,
	"title" varchar NOT NULL,
	"description" text,
	"location" varchar,
	"frequency" "frequencyenum" NOT NULL,
	"start_date" date,
	"due_date" date,
	"qr_token" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "tasks_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
ALTER TABLE "user_org_memberships" ADD CONSTRAINT "user_org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_org_memberships" ADD CONSTRAINT "user_org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;