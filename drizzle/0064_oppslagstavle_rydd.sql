-- Manuelle kontaktpersoner (uten DriftIQ-bruker) finnes ikke lenger som begrep: kontaktene
-- hentes fra brukerprofilene. Tabellen har aldri vært i prod; radene her er testdata.
DELETE FROM "board_contacts" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "board_contacts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "board_contacts_bruker" ON "board_contacts" USING btree ("org_id","user_id");--> statement-breakpoint
ALTER TABLE "board_contacts" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "board_contacts" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "board_contacts" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "board_contacts" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "board_screens" DROP COLUMN "fields";