CREATE TYPE "public"."fylkeenum" AS ENUM('03', '11', '15', '18', '31', '32', '33', '34', '39', '40', '42', '46', '50', '55', '56');--> statement-breakpoint
ALTER TABLE "bbl" ADD COLUMN "county_codes" "fylkeenum"[];--> statement-breakpoint
-- Region fra fritekst til fylkesnummer (lib/fylker.ts). Bare kjente skrivemåter tolkes:
-- de femten fylkesnavnene, og «Vestlandet» som Vestland (avklart 01.10.2026; det er en
-- landsdel, men alle lag som har stått med det, har hørt hjemme i Vestland). Alt annet blir
-- stående i `region` med `county_codes` NULL, og panelet viser det som «Ukjent» til noen
-- velger fylke. Idempotent: rører bare rader uten fylke.
UPDATE "bbl" SET "county_codes" = ARRAY[
  CASE lower(btrim("region"))
    WHEN 'oslo' THEN '03'
    WHEN 'rogaland' THEN '11'
    WHEN 'møre og romsdal' THEN '15'
    WHEN 'nordland' THEN '18'
    WHEN 'østfold' THEN '31'
    WHEN 'akershus' THEN '32'
    WHEN 'buskerud' THEN '33'
    WHEN 'innlandet' THEN '34'
    WHEN 'vestfold' THEN '39'
    WHEN 'telemark' THEN '40'
    WHEN 'agder' THEN '42'
    WHEN 'vestland' THEN '46'
    WHEN 'vestlandet' THEN '46'
    WHEN 'trøndelag' THEN '50'
    WHEN 'troms' THEN '55'
    WHEN 'finnmark' THEN '56'
  END
]::fylkeenum[]
WHERE "county_codes" IS NULL
  AND lower(btrim("region")) IN (
    'oslo', 'rogaland', 'møre og romsdal', 'nordland', 'østfold', 'akershus', 'buskerud',
    'innlandet', 'vestfold', 'telemark', 'agder', 'vestland', 'vestlandet', 'trøndelag',
    'troms', 'finnmark'
  );--> statement-breakpoint
-- Tolket region er overført; fritekst blir bare stående der den IKKE lot seg tolke.
UPDATE "bbl" SET "region" = NULL WHERE "county_codes" IS NOT NULL;
