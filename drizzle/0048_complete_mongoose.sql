CREATE TABLE "audit_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"actor_name" varchar NOT NULL,
	"actor_user_id" varchar,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"module" varchar NOT NULL,
	"entity" varchar NOT NULL,
	"entity_id" varchar,
	"event" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"email" varchar NOT NULL,
	"event" varchar NOT NULL,
	"ip" varchar,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_events_org_tid" ON "audit_events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_auth_events_tid" ON "auth_events" USING btree ("occurred_at");