CREATE TABLE "platform_contracts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"annual_fee" integer,
	"base_fee" integer,
	"modules" text,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_access_log" (
	"id" varchar PRIMARY KEY NOT NULL,
	"superadmin_id" varchar,
	"admin_name" varchar,
	"org_id" varchar NOT NULL,
	"reason" varchar NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "platform_contracts" ADD CONSTRAINT "platform_contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_log" ADD CONSTRAINT "support_access_log_superadmin_id_users_id_fk" FOREIGN KEY ("superadmin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_log" ADD CONSTRAINT "support_access_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;