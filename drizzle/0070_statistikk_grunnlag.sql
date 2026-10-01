CREATE TYPE "public"."avslagsgrunnenum" AS ENUM('for_tidlig', 'forretningsforer', 'pris', 'ingen_respons', 'annet');--> statement-breakpoint
CREATE TYPE "public"."leadkildeenum" AS ENUM('kald_epost', 'anbefaling', 'nettsiden', 'messe', 'annet');--> statement-breakpoint
CREATE TABLE "platform_contract_versions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"annual_amount" integer NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_status_changes" (
	"id" varchar PRIMARY KEY NOT NULL,
	"lead_id" varchar NOT NULL,
	"from_status" varchar NOT NULL,
	"to_status" varchar NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_contracts" ADD COLUMN "renewal_date" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source" "leadkildeenum";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "rejection_reason" "avslagsgrunnenum";--> statement-breakpoint
ALTER TABLE "platform_contract_versions" ADD CONSTRAINT "platform_contract_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_platform_contract_versions_org_fra" ON "platform_contract_versions" USING btree ("org_id","valid_from");--> statement-breakpoint
CREATE INDEX "idx_lead_status_changes_lead_tid" ON "lead_status_changes" USING btree ("lead_id","changed_at");--> statement-breakpoint
-- BL-182: kilde for leads som kom fra landingsskjemaet. Bare den kilden kan utledes sikkert
-- (systemet skrev raden selv); manuelle og v1-migrerte leads blir NULL = «Ikke satt».
UPDATE "leads" SET "source" = 'nettsiden'
WHERE "source" IS NULL
  AND EXISTS (SELECT 1 FROM "lead_activities" a
              WHERE a."lead_id" = "leads"."id" AND a."text" = 'Lead opprettet fra landingssiden');--> statement-breakpoint
-- BL-182: statusbyttene fra før tabellen fantes, lest ut av aktivitetsloggen ÉN gang. Bare de
-- eksakte tekstene `oppdaterLead`/`konverterLead` skriver kjennes igjen; alt annet (notater,
-- v1-tekster) hoppes over. «Fra» er forrige gjenkjente bytte, eller «ny» for det første.
-- Avslagsgrunnen kan IKKE utledes — den var fritekst — og blir stående som NULL.
INSERT INTO "lead_status_changes" ("id", "lead_id", "from_status", "to_status", "changed_at")
SELECT gen_random_uuid()::text, b."lead_id",
       coalesce(lag(b."til") OVER (PARTITION BY b."lead_id" ORDER BY b."created_at", b."id"), 'ny'),
       b."til", b."created_at"
FROM (
  SELECT a."id", a."lead_id", a."created_at",
         CASE
           WHEN a."text" = 'Avslått' THEN 'avslatt'
           WHEN a."text" = 'Opprettet som kunde' THEN 'konvertert'
           WHEN a."text" IN ('Flyttet til Ny', 'Gjenåpnet som Ny') THEN 'ny'
           WHEN a."text" IN ('Flyttet til Kontaktet', 'Gjenåpnet som Kontaktet') THEN 'kontaktet'
           WHEN a."text" IN ('Flyttet til Kvalifisert', 'Gjenåpnet som Kvalifisert') THEN 'kvalifisert'
         END AS "til"
  FROM "lead_activities" a
) b
WHERE b."til" IS NOT NULL;
