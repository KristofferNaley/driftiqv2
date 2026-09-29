CREATE TABLE "board_blocks" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"kind" varchar NOT NULL,
	"name" varchar NOT NULL,
	"config" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_contacts" ADD COLUMN "user_id" varchar;--> statement-breakpoint
ALTER TABLE "board_contacts" ADD COLUMN "show_phone" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "board_contacts" ADD COLUMN "show_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "board_screens" ADD COLUMN "scale" integer DEFAULT 85 NOT NULL;--> statement-breakpoint
ALTER TABLE "board_screens" ADD COLUMN "layout" varchar;--> statement-breakpoint
ALTER TABLE "board_screens" ADD COLUMN "zones" text;--> statement-breakpoint
ALTER TABLE "board_blocks" ADD CONSTRAINT "board_blocks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_blocks" ADD CONSTRAINT "board_blocks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_blocks_org_idx" ON "board_blocks" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "board_contacts" ADD CONSTRAINT "board_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;