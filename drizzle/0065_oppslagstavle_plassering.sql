CREATE TABLE "board_placements" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"block_key" varchar NOT NULL,
	"area" varchar NOT NULL,
	"all_screens" boolean DEFAULT true NOT NULL,
	"screen_ids" varchar[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_placements" ADD CONSTRAINT "board_placements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_placements_nokkel" ON "board_placements" USING btree ("org_id","block_key");--> statement-breakpoint
ALTER TABLE "board_screens" DROP COLUMN "zones";