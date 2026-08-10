ALTER TABLE "log_entries" ADD COLUMN "created_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "deviation_attachments" ADD COLUMN "uploaded_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "deviation_logs" ADD COLUMN "changed_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "deviation_treatments" ADD COLUMN "created_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "deviations" ADD COLUMN "reported_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "deviations" ADD COLUMN "resolved_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "unit_works" ADD COLUMN "created_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "completions" ADD COLUMN "completed_by_user_id" varchar;--> statement-breakpoint
ALTER TABLE "completions" ADD COLUMN "vendor_id" varchar;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_attachments" ADD CONSTRAINT "deviation_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_logs" ADD CONSTRAINT "deviation_logs_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_treatments" ADD CONSTRAINT "deviation_treatments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_works" ADD CONSTRAINT "unit_works_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
/*
 * BACKFILL — bare der navnet peker ENTYDIG på én person i samme organisasjon.
 *
 * Alt over dette punktet er generert av drizzle-kit. Resten er skrevet for hånd, og hører i
 * migrasjonen fordi den skal kjøre ÉN gang: den fyller de nye id-kolonnene for historikk som
 * ble skrevet før de fantes. Kjøres den om igjen, gjør `IS NULL`-filteret den til en no-op.
 *
 * `HAVING count(*) = 1` er ikke en optimalisering, den er hele forsiktigheten: sitter det to
 * personer med samme navn i samme lag, vet vi ikke hvem av dem som førte raden, og da skal
 * kolonnen forbli NULL. En gjetning her ville tilskrevet én person en annens arbeid — og
 * `lib/aktivitet.ts` faller uansett tilbake på navnetreff for rader uten id, så en tom kolonne
 * gir samme resultat som før, mens en feil kolonne gir et galt svar med selvtillit.
 *
 * Navn sammenlignes med `lower(btrim(...))` på begge sider: Enhetsregisteret leverer navn i
 * store bokstaver, og manuelt innskrevne navn har etterslepende mellomrom.
 *
 * `completions.vendor_id` backfylles IKKE. Den skal være leverandøren som sto på oppgaven DA
 * jobben ble gjort, og for gamle rader kjenner vi bare leverandøren som står der nå — se
 * kommentaren på kolonnen.
 */
UPDATE "completions" c SET "completed_by_user_id" = k.user_id
FROM "tasks" t,
     (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE c.task_id = t.id AND c."completed_by_user_id" IS NULL
  AND k.org_id = t.org_id AND k.navn = lower(btrim(c."completed_by"));
--> statement-breakpoint
UPDATE "deviations" d SET "reported_by_user_id" = k.user_id
FROM (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE d."reported_by_user_id" IS NULL
  AND k.org_id = d.org_id AND k.navn = lower(btrim(d."reported_by"));
--> statement-breakpoint
UPDATE "deviations" d SET "resolved_by_user_id" = k.user_id
FROM (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE d."resolved_by_user_id" IS NULL AND d."resolved_by" IS NOT NULL
  AND k.org_id = d.org_id AND k.navn = lower(btrim(d."resolved_by"));
--> statement-breakpoint
UPDATE "deviation_treatments" b SET "created_by_user_id" = k.user_id
FROM "deviations" d,
     (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE b.deviation_id = d.id AND b."created_by_user_id" IS NULL
  AND k.org_id = d.org_id AND k.navn = lower(btrim(b."created_by"));
--> statement-breakpoint
UPDATE "deviation_logs" l SET "changed_by_user_id" = k.user_id
FROM "deviations" d,
     (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE l.deviation_id = d.id AND l."changed_by_user_id" IS NULL
  AND k.org_id = d.org_id AND k.navn = lower(btrim(l."changed_by"));
--> statement-breakpoint
UPDATE "deviation_attachments" v SET "uploaded_by_user_id" = k.user_id
FROM (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE v."uploaded_by_user_id" IS NULL
  AND k.org_id = v.org_id AND k.navn = lower(btrim(v."uploaded_by"));
--> statement-breakpoint
UPDATE "log_entries" e SET "created_by_user_id" = k.user_id
FROM (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE e."created_by_user_id" IS NULL
  AND k.org_id = e.org_id AND k.navn = lower(btrim(e."created_by"));
--> statement-breakpoint
UPDATE "unit_works" w SET "created_by_user_id" = k.user_id
FROM (SELECT m.org_id, lower(btrim(u.name)) AS navn, min(u.id) AS user_id
        FROM "user_org_memberships" m JOIN "users" u ON u.id = m.user_id
       GROUP BY m.org_id, lower(btrim(u.name)) HAVING count(*) = 1) k
WHERE w."created_by_user_id" IS NULL
  AND k.org_id = w.org_id AND k.navn = lower(btrim(w."created_by"));
