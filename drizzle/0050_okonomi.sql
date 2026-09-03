CREATE TABLE "budget_lines" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"budget_id" varchar NOT NULL,
	"kind" varchar NOT NULL,
	"name" varchar NOT NULL,
	"account_from" integer,
	"account_to" integer,
	"amount" integer DEFAULT 0 NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"year" integer NOT NULL,
	"status" varchar DEFAULT 'utkast' NOT NULL,
	"adopted_date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_run_lines" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"fee_run_id" varchar NOT NULL,
	"unit_id" varchar NOT NULL,
	"owner_id" varchar,
	"owner_name" varchar,
	"month" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" integer NOT NULL,
	"order_reference" varchar NOT NULL,
	"external_ref" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_runs" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar DEFAULT 'grunnlag' NOT NULL,
	"due_day" integer DEFAULT 15 NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"missing_owners" integer DEFAULT 0 NOT NULL,
	"created_by" varchar NOT NULL,
	"created_by_user_id" varchar,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"vendor_id" varchar,
	"supplier_name" varchar,
	"contract_id" varchar,
	"budget_line_id" varchar,
	"invoice_number" varchar,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"amount" integer NOT NULL,
	"kid" varchar,
	"description" varchar,
	"note" text,
	"status" varchar DEFAULT 'mottatt' NOT NULL,
	"registered_by" varchar NOT NULL,
	"registered_by_user_id" varchar,
	"decided_by" varchar,
	"decided_by_user_id" varchar,
	"decided_at" timestamp with time zone,
	"decision_note" varchar,
	"paid_date" date,
	"file_name" varchar,
	"file_original_name" varchar,
	"file_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_fee_rates" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"unit_id" varchar NOT NULL,
	"budget_id" varchar,
	"monthly_amount" integer NOT NULL,
	"valid_from" date NOT NULL,
	"source" varchar DEFAULT 'beregnet' NOT NULL,
	"note" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_owners" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"unit_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar,
	"phone" varchar,
	"invoice_address" text,
	"owner_from" date NOT NULL,
	"owner_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "brok_teller" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "brok_nevner" integer;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_run_lines" ADD CONSTRAINT "fee_run_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_run_lines" ADD CONSTRAINT "fee_run_lines_fee_run_id_fee_runs_id_fk" FOREIGN KEY ("fee_run_id") REFERENCES "public"."fee_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_run_lines" ADD CONSTRAINT "fee_run_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_run_lines" ADD CONSTRAINT "fee_run_lines_owner_id_unit_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."unit_owners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_runs" ADD CONSTRAINT "fee_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_runs" ADD CONSTRAINT "fee_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_budget_line_id_budget_lines_id_fk" FOREIGN KEY ("budget_line_id") REFERENCES "public"."budget_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_fee_rates" ADD CONSTRAINT "unit_fee_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_fee_rates" ADD CONSTRAINT "unit_fee_rates_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_fee_rates" ADD CONSTRAINT "unit_fee_rates_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_owners" ADD CONSTRAINT "unit_owners_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_owners" ADD CONSTRAINT "unit_owners_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_budget_lines_budget" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_budgets_org_year" ON "budgets" USING btree ("org_id","year");--> statement-breakpoint
CREATE INDEX "idx_fee_run_lines_run" ON "fee_run_lines" USING btree ("fee_run_id");--> statement-breakpoint
CREATE INDEX "idx_fee_run_lines_unit" ON "fee_run_lines" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "idx_supplier_invoices_org_status" ON "supplier_invoices" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_unit_fee_rates_unit_from" ON "unit_fee_rates" USING btree ("unit_id","valid_from");--> statement-breakpoint
CREATE INDEX "idx_unit_owners_unit" ON "unit_owners" USING btree ("unit_id");