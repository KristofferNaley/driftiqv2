ALTER TABLE "hazards" ADD COLUMN "last_assessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hazards" ADD COLUMN "context" varchar;--> statement-breakpoint
-- Backfill: farer som alt HAR en vurdering får opprettelsesdatoen som «sist vurdert» —
-- ellers ville alle eksisterende, reelt vurderte farer blitt flagget «Vurder på nytt».
UPDATE "hazards" SET "last_assessed_at" = "created_at" WHERE "probability" IS NOT NULL AND "consequence" IS NOT NULL;