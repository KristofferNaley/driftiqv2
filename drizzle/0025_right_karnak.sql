CREATE TABLE "leads" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar,
	"company" varchar,
	"message" text,
	"status" varchar DEFAULT 'ny' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
