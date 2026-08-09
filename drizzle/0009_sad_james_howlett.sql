CREATE TABLE "completion_checklist_results" (
	"id" varchar PRIMARY KEY NOT NULL,
	"completion_id" varchar NOT NULL,
	"item_id" varchar,
	"text" varchar NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"task_id" varchar NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by" varchar NOT NULL,
	"notes" text,
	"has_deviation" boolean DEFAULT false NOT NULL,
	"deviation_description" text,
	"manual" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_checklist_items" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "task_checklist_items" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "show_on_arshjul" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "unit_id" varchar;--> statement-breakpoint
ALTER TABLE "completion_checklist_results" ADD CONSTRAINT "completion_checklist_results_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_checklist_results" ADD CONSTRAINT "completion_checklist_results_item_id_task_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."task_checklist_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;