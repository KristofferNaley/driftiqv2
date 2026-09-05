CREATE TABLE "unloc_settings" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"client_id" varchar NOT NULL,
	"client_secret_enc" text NOT NULL,
	"project_id" varchar NOT NULL,
	"project_name" varchar NOT NULL,
	"unloc_organization_id" varchar,
	"connected_by" varchar NOT NULL,
	"connected_by_user_id" varchar,
	"last_error" varchar,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_unloc_keys" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"unloc_key_id" varchar NOT NULL,
	"lock_id" varchar NOT NULL,
	"lock_name" varchar NOT NULL,
	"phone" varchar NOT NULL,
	"holder_name" varchar NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"state" varchar DEFAULT 'creating' NOT NULL,
	"state_checked_at" timestamp with time zone,
	"note" text,
	"issued_by" varchar NOT NULL,
	"issued_by_user_id" varchar,
	"revoked_by" varchar,
	"revoked_by_user_id" varchar,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unloc_settings" ADD CONSTRAINT "unloc_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unloc_settings" ADD CONSTRAINT "unloc_settings_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_unloc_keys" ADD CONSTRAINT "vendor_unloc_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_unloc_keys" ADD CONSTRAINT "vendor_unloc_keys_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_unloc_keys" ADD CONSTRAINT "vendor_unloc_keys_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_unloc_keys" ADD CONSTRAINT "vendor_unloc_keys_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_unloc_settings_org" ON "unloc_settings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_vendor_unloc_keys_vendor" ON "vendor_unloc_keys" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vendor_unloc_keys_org_key" ON "vendor_unloc_keys" USING btree ("org_id","unloc_key_id");