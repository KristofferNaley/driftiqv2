CREATE TABLE "board_post_pages" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"post_id" varchar NOT NULL,
	"position" integer NOT NULL,
	"file_name" varchar NOT NULL,
	"content_type" varchar NOT NULL,
	"file_size" integer NOT NULL,
	"caption" varchar,
	"focus_x" integer DEFAULT 50 NOT NULL,
	"focus_y" integer DEFAULT 50 NOT NULL,
	"fit" varchar DEFAULT 'dekk' NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_posts" ADD COLUMN "layout_mode" varchar;--> statement-breakpoint
ALTER TABLE "board_posts" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "board_post_pages" ADD CONSTRAINT "board_post_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_post_pages" ADD CONSTRAINT "board_post_pages_post_id_board_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."board_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_post_pages_org_idx" ON "board_post_pages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "board_post_pages_post_idx" ON "board_post_pages" USING btree ("post_id");--> statement-breakpoint
-- DATAMIGRERING: bildeoppslag hadde ett bilde i selve raden. Hvert av dem får én side som
-- peker på SAMME fil (ingen konvertering), med tittelen som bildetekst — skjermen viser da
-- det samme som før. Filkolonnene i board_posts tømmes, ellers telles fila to ganger i
-- kvoten. tests/tavlebilder.test.ts kjører de to setningene under mot en rad i gammel form.
INSERT INTO "board_post_pages" ("id", "org_id", "post_id", "position", "file_name", "content_type", "file_size", "caption")
SELECT gen_random_uuid()::varchar, "org_id", "id", 0, "file_name", COALESCE("content_type", 'image/jpeg'), COALESCE("file_size", 0), LEFT("title", 80)
FROM "board_posts" WHERE "kind" = 'bilde' AND "file_name" IS NOT NULL;--> statement-breakpoint
UPDATE "board_posts" SET "kind" = 'bilder', "layout_mode" = 'bla', "file_name" = NULL, "content_type" = NULL, "file_size" = NULL WHERE "kind" = 'bilde';
