CREATE TABLE "easee_charger_hours" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"charger_row_id" varchar NOT NULL,
	"hour_start" timestamp with time zone NOT NULL,
	"kwh" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "easee_price_plans" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"valid_from" date NOT NULL,
	"name" varchar NOT NULL,
	"kraft_model" varchar NOT NULL,
	"kraft_ore" integer DEFAULT 0 NOT NULL,
	"paaslag_ore" integer DEFAULT 0 NOT NULL,
	"price_area" varchar,
	"mva_prosent" integer DEFAULT 25 NOT NULL,
	"nett_dag_ore" integer DEFAULT 0 NOT NULL,
	"nett_natt_ore" integer DEFAULT 0 NOT NULL,
	"natt_fra" integer DEFAULT 22 NOT NULL,
	"natt_til" integer DEFAULT 6 NOT NULL,
	"helg_som_natt" boolean DEFAULT true NOT NULL,
	"fastledd_ore" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" varchar NOT NULL,
	"created_by_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "easee_sessions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"charger_row_id" varchar NOT NULL,
	"easee_session_id" integer NOT NULL,
	"car_connected" timestamp with time zone NOT NULL,
	"car_disconnected" timestamp with time zone,
	"kwh" double precision NOT NULL,
	"is_complete" boolean DEFAULT true NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "power_prices" (
	"id" varchar PRIMARY KEY NOT NULL,
	"area" varchar NOT NULL,
	"hour_start" timestamp with time zone NOT NULL,
	"nok_per_kwh" double precision NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parking_spots" ADD COLUMN "unit_id" varchar;--> statement-breakpoint
ALTER TABLE "easee_charger_hours" ADD CONSTRAINT "easee_charger_hours_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_charger_hours" ADD CONSTRAINT "easee_charger_hours_charger_row_id_easee_chargers_id_fk" FOREIGN KEY ("charger_row_id") REFERENCES "public"."easee_chargers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_price_plans" ADD CONSTRAINT "easee_price_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_price_plans" ADD CONSTRAINT "easee_price_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_sessions" ADD CONSTRAINT "easee_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_sessions" ADD CONSTRAINT "easee_sessions_charger_row_id_easee_chargers_id_fk" FOREIGN KEY ("charger_row_id") REFERENCES "public"."easee_chargers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_easee_charger_hours_hour" ON "easee_charger_hours" USING btree ("charger_row_id","hour_start");--> statement-breakpoint
CREATE INDEX "idx_easee_charger_hours_org_hour" ON "easee_charger_hours" USING btree ("org_id","hour_start");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_easee_price_plans_org_from" ON "easee_price_plans" USING btree ("org_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_easee_sessions_session" ON "easee_sessions" USING btree ("charger_row_id","easee_session_id");--> statement-breakpoint
CREATE INDEX "idx_easee_sessions_org_start" ON "easee_sessions" USING btree ("org_id","car_connected");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_power_prices_area_hour" ON "power_prices" USING btree ("area","hour_start");--> statement-breakpoint
ALTER TABLE "parking_spots" ADD CONSTRAINT "parking_spots_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "easee_settings" DROP COLUMN "price_per_kwh_ore";