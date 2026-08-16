-- Globalt søk: norsk fulltekst (FTS) + trigram, per tabell.
--
-- HÅNDSKREVET migrasjon (drizzle-kit generate --custom) — drizzle kan ikke uttrykke
-- GIN-uttrykksindekser. To indekser per tabell, og begge trengs: søket er
-- `fts @@ query OR tittel ILIKE '%q%'`, og en OR der bare den ene grenen er indeksert
-- tvinger seq scan. ILIKE-grenen er ikke en reserve, den er norsken: snowball-stemmeren
-- dekomponerer ikke sammensatte ord, så «lekkasje» treffer «vannlekkasje» kun via trigram.
--
-- UTTRYKKENE SPEILES i SOK_UTTRYKK i src/lib/sok.ts. Postgres matcher indeksen på
-- uttrykkstreet — avviker spørringen semantisk (kolonner, coalesce, rekkefølge), blir det
-- stille seq scan uten feilmelding. Endres noe her, må sok.ts endres i samme commit.
--
-- Ingen CONCURRENTLY: migratoren kjører i transaksjon, ved boot, før trafikk.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deviations_sok_fts" ON "deviations" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'') || ' ' || coalesce("resolution_notes",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deviations_sok_trgm" ON "deviations" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_sok_fts" ON "tasks" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_sok_trgm" ON "tasks" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_sok_fts" ON "contracts" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("notes",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contracts_sok_trgm" ON "contracts" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_sok_fts" ON "documents" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'') || ' ' || coalesce("original_name",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_sok_trgm" ON "documents" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_entries_sok_fts" ON "log_entries" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_entries_sok_trgm" ON "log_entries" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routines_sok_fts" ON "routines" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routines_sok_trgm" ON "routines" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_sok_fts" ON "vendors" USING GIN (to_tsvector('norwegian', coalesce("name",'') || ' ' || coalesce("notes",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_sok_trgm" ON "vendors" USING GIN ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "annual_events_sok_fts" ON "annual_events" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "annual_events_sok_trgm" ON "annual_events" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "building_elements_sok_fts" ON "building_elements" USING GIN (to_tsvector('norwegian', coalesce("name",'') || ' ' || coalesce("notes",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "building_elements_sok_trgm" ON "building_elements" USING GIN ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hazards_sok_fts" ON "hazards" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hazards_sok_trgm" ON "hazards" USING GIN ("title" gin_trgm_ops);
