CREATE TABLE "auth_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"email" varchar NOT NULL,
	"event" varchar NOT NULL,
	"ip" varchar,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_events_tid" ON "auth_events" USING btree ("occurred_at");