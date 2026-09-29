CREATE TABLE "board_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"event_date" date NOT NULL,
	"event_time" varchar,
	"place" varchar,
	"created_by" varchar NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_pairings" (
	"code" varchar PRIMARY KEY NOT NULL,
	"secret_hash" varchar NOT NULL,
	"screen_id" varchar,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_pairings_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "board_posts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"kind" varchar NOT NULL,
	"title" varchar NOT NULL,
	"body" text,
	"category" varchar,
	"file_name" varchar,
	"original_name" varchar,
	"content_type" varchar,
	"file_size" integer,
	"show_from" date NOT NULL,
	"show_until" date NOT NULL,
	"all_screens" boolean DEFAULT true NOT NULL,
	"screen_ids" varchar[] DEFAULT '{}' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_screens" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"address" varchar,
	"orientation" varchar DEFAULT 'staende' NOT NULL,
	"fields" text,
	"device_token_hash" varchar NOT NULL,
	"last_seen_at" timestamp with time zone,
	"paired_by" varchar NOT NULL,
	"paired_by_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_screens_device_token_hash_unique" UNIQUE("device_token_hash")
);
--> statement-breakpoint
CREATE TABLE "board_settings" (
	"org_id" varchar PRIMARY KEY NOT NULL,
	"background" varchar NOT NULL,
	"accent" varchar NOT NULL,
	"file_name" varchar,
	"content_type" varchar,
	"file_size" integer,
	"offline_mode" varchar DEFAULT 'siste' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_events" ADD CONSTRAINT "board_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_events" ADD CONSTRAINT "board_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_pairings" ADD CONSTRAINT "board_pairings_screen_id_board_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."board_screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_screens" ADD CONSTRAINT "board_screens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_screens" ADD CONSTRAINT "board_screens_paired_by_user_id_users_id_fk" FOREIGN KEY ("paired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_events_org_idx" ON "board_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "board_posts_org_idx" ON "board_posts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "board_screens_org_idx" ON "board_screens" USING btree ("org_id");