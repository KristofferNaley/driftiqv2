CREATE TABLE "easee_charger_usage" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"charger_row_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"kwh" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "easee_chargers" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"charger_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"circuit_name" varchar,
	"spot_id" varchar,
	"active" boolean DEFAULT true NOT NULL,
	"op_mode" integer,
	"is_online" boolean,
	"total_power" double precision,
	"session_energy" double precision,
	"lifetime_energy" double precision,
	"state_checked_at" timestamp with time zone,
	"usage_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "easee_settings" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"user_name" varchar NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"site_id" integer NOT NULL,
	"site_name" varchar NOT NULL,
	"account_email" varchar,
	"price_per_kwh_ore" integer,
	"connected_by" varchar NOT NULL,
	"connected_by_user_id" varchar,
	"last_error" varchar,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "easee_charger_usage" ADD CONSTRAINT "easee_charger_usage_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_charger_usage" ADD CONSTRAINT "easee_charger_usage_charger_row_id_easee_chargers_id_fk" FOREIGN KEY ("charger_row_id") REFERENCES "public"."easee_chargers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_chargers" ADD CONSTRAINT "easee_chargers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_chargers" ADD CONSTRAINT "easee_chargers_spot_id_parking_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_settings" ADD CONSTRAINT "easee_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_settings" ADD CONSTRAINT "easee_settings_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_easee_charger_usage_month" ON "easee_charger_usage" USING btree ("charger_row_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_easee_chargers_org_charger" ON "easee_chargers" USING btree ("org_id","charger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_easee_settings_org" ON "easee_settings" USING btree ("org_id");