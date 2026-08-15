CREATE TABLE "pricing_versions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"floor_price" integer NOT NULL,
	"tiers" text NOT NULL,
	"module_defaults" text NOT NULL,
	"note" text,
	"valid_from" date,
	"created_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
