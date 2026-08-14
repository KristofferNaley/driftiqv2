CREATE TABLE "risk_review_items" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"review_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"category" varchar,
	"description" text,
	"probability" integer,
	"consequence" integer,
	"status" varchar NOT NULL,
	"owner" varchar,
	"actions" text,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_reviews" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"context" varchar,
	"review_date" date NOT NULL,
	"participants" varchar,
	"conclusion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risk_review_items" ADD CONSTRAINT "risk_review_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_review_items" ADD CONSTRAINT "risk_review_items_review_id_risk_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."risk_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;