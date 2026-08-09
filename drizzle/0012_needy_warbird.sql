CREATE TABLE "contract_price_history" (
	"id" varchar PRIMARY KEY NOT NULL,
	"contract_id" varchar NOT NULL,
	"effective_date" date NOT NULL,
	"annual_sum" integer NOT NULL,
	"note" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"vendor_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"category" varchar,
	"annual_sum" integer,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"contact_name" varchar,
	"contact_email" varchar,
	"contact_phone" varchar,
	"file_name" varchar,
	"file_original_name" varchar,
	"file_size" integer,
	"ai_readable" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"archive_note" varchar,
	"predecessor_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_price_history" ADD CONSTRAINT "contract_price_history_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;