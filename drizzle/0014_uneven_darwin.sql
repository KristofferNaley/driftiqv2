CREATE TABLE "vendor_access_items" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"areas" varchar,
	"status" varchar DEFAULT 'utlevert' NOT NULL,
	"issued_to" varchar,
	"issued_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_contacts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"role" varchar,
	"email" varchar,
	"phone" varchar,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_notes" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"text" text NOT NULL,
	"author_name" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vendors" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "vendors" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "relationship_type" varchar DEFAULT 'avtale' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "category" varchar;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "customer_number" varchar;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "ehf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "last_used_at" date;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "org_number" varchar;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "invoice_reference" varchar;--> statement-breakpoint
ALTER TABLE "vendor_access_items" ADD CONSTRAINT "vendor_access_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_access_items" ADD CONSTRAINT "vendor_access_items_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_notes" ADD CONSTRAINT "vendor_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_notes" ADD CONSTRAINT "vendor_notes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;