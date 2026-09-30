ALTER TABLE "board_posts" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_screens" ADD COLUMN "zones" jsonb;