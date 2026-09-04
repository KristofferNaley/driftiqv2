CREATE TABLE "fiken_connections" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"company_slug" varchar NOT NULL,
	"company_name" varchar NOT NULL,
	"company_org_number" varchar,
	"vat_type" varchar,
	"auth_mode" varchar NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"connected_by" varchar NOT NULL,
	"connected_by_user_id" varchar,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiken_purchases" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"fiken_id" varchar NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"identifier" varchar,
	"supplier_name" varchar,
	"supplier_org_number" varchar,
	"gross" integer NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"lines" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiken_connections" ADD CONSTRAINT "fiken_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiken_connections" ADD CONSTRAINT "fiken_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiken_purchases" ADD CONSTRAINT "fiken_purchases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fiken_connections_org" ON "fiken_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fiken_purchases_org_fiken" ON "fiken_purchases" USING btree ("org_id","fiken_id");--> statement-breakpoint
CREATE INDEX "idx_fiken_purchases_org_date" ON "fiken_purchases" USING btree ("org_id","date");