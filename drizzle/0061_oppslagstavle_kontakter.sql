CREATE TABLE "board_contacts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"role" varchar,
	"phone" varchar,
	"email" varchar,
	"file_name" varchar,
	"content_type" varchar,
	"file_size" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_posts" ADD COLUMN "display_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_contacts" ADD CONSTRAINT "board_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_contacts_org_idx" ON "board_contacts" USING btree ("org_id");