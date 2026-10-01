CREATE TYPE "public"."orgformenum" AS ENUM('BRL', 'ESEK', 'SAM', 'AS');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "org_form_code" "orgformenum";--> statement-breakpoint
-- BL-180: fyll koden fra fritekstfeltet. Trimmes og sammenlignes med små bokstaver, og bare
-- KJENTE varianter kobles. Det som ikke kan kobles, blir NULL og står igjen i «org_form» —
-- det gjettes ikke, det listes av scripts/selskapsform-rapport.ts og tas med eier.
-- «Sameie» (v1s normalisering) kobles bevisst IKKE: det kan være både ESEK og SAM.
UPDATE "organizations" SET "org_form_code" = CASE lower(btrim("org_form"))
  WHEN 'borettslag' THEN 'BRL'
  WHEN 'brl' THEN 'BRL'
  WHEN 'eierseksjonssameie' THEN 'ESEK'
  WHEN 'esek' THEN 'ESEK'
  WHEN 'tingsrettslig sameie' THEN 'SAM'
  WHEN 'sam' THEN 'SAM'
  WHEN 'boligaksjeselskap' THEN 'AS'
  WHEN 'aksjeselskap' THEN 'AS'
  WHEN 'as' THEN 'AS'
END::"orgformenum"
WHERE "org_form" IS NOT NULL;--> statement-breakpoint
-- «DEMO» var aldri en selskapsform, men demo-flagget skrevet i feil felt (flagget `demo`
-- finnes). Demo-orgene får flagget og formen navnet sier (avklart med eier 01.10.2026:
-- «DEMO - Det Beste Borettslaget» = BRL, «DEMO - Sammen Sameie» = ESEK).
UPDATE "organizations" SET
  "demo" = true,
  "org_form_code" = CASE
    WHEN "name" ILIKE '%borettslag%' THEN 'BRL'
    WHEN "name" ILIKE '%sameie%' THEN 'ESEK'
  END::"orgformenum"
WHERE lower(btrim("org_form")) = 'demo';--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT "name", "org_form" FROM "organizations"
           WHERE "org_form" IS NOT NULL AND "org_form_code" IS NULL LOOP
    RAISE NOTICE 'Selskapsform ikke koblet: % («%»)', r."name", r."org_form";
  END LOOP;
END $$;
