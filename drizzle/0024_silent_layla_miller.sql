CREATE TABLE "completion_photos" (
	"id" varchar PRIMARY KEY NOT NULL,
	"completion_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"filename" varchar NOT NULL,
	"original_name" varchar NOT NULL,
	"content_type" varchar,
	"file_size" bigint,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "completion_photos" ADD CONSTRAINT "completion_photos_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_photos" ADD CONSTRAINT "completion_photos_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;