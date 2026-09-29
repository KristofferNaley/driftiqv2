CREATE TABLE "bir_pickups" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"fraction" varchar NOT NULL,
	"pickup_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bir_settings" (
	"org_id" varchar PRIMARY KEY NOT NULL,
	"bir_id" varchar NOT NULL,
	"bir_name" varchar NOT NULL,
	"real_estate_id" varchar,
	"connected_by" varchar NOT NULL,
	"connected_by_user_id" varchar,
	"last_synced_at" timestamp with time zone,
	"last_error" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bir_pickups" ADD CONSTRAINT "bir_pickups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bir_settings" ADD CONSTRAINT "bir_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bir_settings" ADD CONSTRAINT "bir_settings_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bir_pickups_org_idx" ON "bir_pickups" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bir_pickups_unik" ON "bir_pickups" USING btree ("org_id","fraction","pickup_date");