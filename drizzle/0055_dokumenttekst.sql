ALTER TABLE "documents" ADD COLUMN "content_text" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_source" varchar;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_error" varchar;--> statement-breakpoint
-- Tekstsøk i dokumentinnhold (docs/tekstsok.md). Håndskrevet del, som 0047: FTS-uttrykket
-- for documents får content_text med, og innholdet får egen trigram-indeks for ILIKE-grenen.
-- UTTRYKKENE SPEILES i KILDER[dokumentarkiv] i src/lib/sok.ts — avviker de, blir det stille
-- seq scan. Endres noe her, endres sok.ts i samme commit.
DROP INDEX IF EXISTS "documents_sok_fts";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_sok_fts" ON "documents" USING GIN (to_tsvector('norwegian', coalesce("title",'') || ' ' || coalesce("description",'') || ' ' || coalesce("original_name",'') || ' ' || coalesce("content_text",'')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_sok_innhold_trgm" ON "documents" USING GIN (coalesce("content_text",'') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_text_pending" ON "documents" ("uploaded_at") WHERE "text_extracted_at" IS NULL;
