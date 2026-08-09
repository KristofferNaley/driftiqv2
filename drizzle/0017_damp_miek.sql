CREATE TABLE "hazard_actions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"hazard_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"status" varchar DEFAULT 'not_started' NOT NULL,
	"due_date" date,
	"owner" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hazards" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"category" varchar,
	"description" text,
	"probability" integer NOT NULL,
	"consequence" integer NOT NULL,
	"owner" varchar,
	"status" varchar DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hms_evaluations" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"evaluated_date" date,
	"participants" varchar,
	"meeting" varchar,
	"conclusion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_hms_evaluation_year" UNIQUE("org_id","year")
);
--> statement-breakpoint
CREATE TABLE "hms_goal_approvals" (
	"id" varchar PRIMARY KEY NOT NULL,
	"goal_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_hms_goal_user_approval" UNIQUE("goal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hms_goals" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"goal_text" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"responsible_user_id" varchar,
	"approved" boolean DEFAULT false NOT NULL,
	"approved_date" date,
	"approved_meeting" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_hms_goal_year" UNIQUE("org_id","year")
);
--> statement-breakpoint
CREATE TABLE "hms_responsibilities" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"area" varchar NOT NULL,
	"person_name" varchar,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_hms_responsibility_area" UNIQUE("org_id","area")
);
--> statement-breakpoint
CREATE TABLE "hms_sub_goals" (
	"id" varchar PRIMARY KEY NOT NULL,
	"goal_id" varchar NOT NULL,
	"category" varchar,
	"text" varchar NOT NULL,
	"owner" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_round_items" (
	"id" varchar PRIMARY KEY NOT NULL,
	"round_id" varchar NOT NULL,
	"text" varchar NOT NULL,
	"section" varchar,
	"checked" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_round_participants" (
	"id" varchar PRIMARY KEY NOT NULL,
	"round_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"role" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_rounds" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"round_date" date,
	"status" varchar DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deviations" ADD COLUMN "round_id" varchar;--> statement-breakpoint
ALTER TABLE "deviations" ADD COLUMN "round_item_id" varchar;--> statement-breakpoint
ALTER TABLE "hazard_actions" ADD CONSTRAINT "hazard_actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazard_actions" ADD CONSTRAINT "hazard_actions_hazard_id_hazards_id_fk" FOREIGN KEY ("hazard_id") REFERENCES "public"."hazards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hazards" ADD CONSTRAINT "hazards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_evaluations" ADD CONSTRAINT "hms_evaluations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_goal_approvals" ADD CONSTRAINT "hms_goal_approvals_goal_id_hms_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."hms_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_goal_approvals" ADD CONSTRAINT "hms_goal_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_goals" ADD CONSTRAINT "hms_goals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_goals" ADD CONSTRAINT "hms_goals_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_responsibilities" ADD CONSTRAINT "hms_responsibilities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hms_sub_goals" ADD CONSTRAINT "hms_sub_goals_goal_id_hms_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."hms_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_round_items" ADD CONSTRAINT "safety_round_items_round_id_safety_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."safety_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_round_participants" ADD CONSTRAINT "safety_round_participants_round_id_safety_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."safety_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_rounds" ADD CONSTRAINT "safety_rounds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_round_id_safety_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."safety_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_round_item_id_safety_round_items_id_fk" FOREIGN KEY ("round_item_id") REFERENCES "public"."safety_round_items"("id") ON DELETE no action ON UPDATE no action;