ALTER TABLE "completion_checklist_results" ADD COLUMN "value" numeric;--> statement-breakpoint
ALTER TABLE "completion_checklist_results" ADD COLUMN "unit" varchar;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD COLUMN "type" varchar DEFAULT 'avkryssing' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD COLUMN "unit" varchar;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD COLUMN "required" boolean DEFAULT false NOT NULL;