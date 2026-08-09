CREATE TABLE "building_elements" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"icon" varchar DEFAULT '🏗' NOT NULL,
	"category" varchar,
	"installed_year" integer,
	"condition_grade" varchar,
	"expected_lifetime_years" integer,
	"next_action_year" integer,
	"estimated_cost" integer,
	"vendor_id" varchar,
	"warranty_years" integer,
	"warranty_expires" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "element_documents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"element_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"fdv_type" varchar DEFAULT 'annet' NOT NULL,
	"title" varchar NOT NULL,
	"filename" varchar NOT NULL,
	"original_name" varchar NOT NULL,
	"content_type" varchar NOT NULL,
	"file_size" integer,
	"uploaded_by" varchar NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "element_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"element_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"service_date" date NOT NULL,
	"title" varchar NOT NULL,
	"performed_by" varchar,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_work_documents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"work_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"doc_type" varchar DEFAULT 'annet' NOT NULL,
	"title" varchar NOT NULL,
	"filename" varchar NOT NULL,
	"original_name" varchar NOT NULL,
	"content_type" varchar NOT NULL,
	"file_size" integer,
	"uploaded_by" varchar NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_works" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"unit_id" varchar NOT NULL,
	"unit_label" varchar NOT NULL,
	"element_id" varchar,
	"category" varchar DEFAULT 'annet' NOT NULL,
	"work_type" varchar DEFAULT 'vedlikehold' NOT NULL,
	"work_date" date NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"vendor_id" varchar,
	"performed_by" varchar,
	"paid_by" varchar DEFAULT 'borettslag' NOT NULL,
	"cost" integer,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "building_elements" ADD CONSTRAINT "building_elements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_elements" ADD CONSTRAINT "building_elements_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_documents" ADD CONSTRAINT "element_documents_element_id_building_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."building_elements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_documents" ADD CONSTRAINT "element_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_services" ADD CONSTRAINT "element_services_element_id_building_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."building_elements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_services" ADD CONSTRAINT "element_services_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_work_documents" ADD CONSTRAINT "unit_work_documents_work_id_unit_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."unit_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_work_documents" ADD CONSTRAINT "unit_work_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_works" ADD CONSTRAINT "unit_works_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_works" ADD CONSTRAINT "unit_works_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_works" ADD CONSTRAINT "unit_works_element_id_building_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."building_elements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_works" ADD CONSTRAINT "unit_works_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;