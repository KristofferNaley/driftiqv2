CREATE TABLE "org_webhooks" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"target_type" varchar NOT NULL,
	"url" text NOT NULL,
	"events" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_ok" boolean,
	"last_error" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_webhooks" ADD CONSTRAINT "org_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;