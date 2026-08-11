ALTER TABLE "safety_round_items" ADD COLUMN "status" varchar;--> statement-breakpoint
ALTER TABLE "safety_rounds" ADD COLUMN "due_date" date;--> statement-breakpoint
UPDATE "safety_round_items" SET "status" = 'ok' WHERE "checked" = true;
