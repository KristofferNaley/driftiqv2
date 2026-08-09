CREATE TABLE "document_folders" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"parent_id" varchar,
	"name" varchar NOT NULL,
	"icon" varchar DEFAULT '📁' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"folder" varchar DEFAULT 'annet' NOT NULL,
	"document_date" date,
	"title" varchar NOT NULL,
	"description" text,
	"filename" varchar NOT NULL,
	"original_name" varchar NOT NULL,
	"content_type" varchar NOT NULL,
	"file_size" integer,
	"uploaded_by" varchar NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_readable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;