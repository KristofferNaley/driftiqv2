import { orgRute } from "@/lib/api";
import { hentForbruk } from "@/lib/ai";

/** Kun tellere — aldri spørsmål, svar eller bruker-id. Derfor trygt for kontoadmin å se. */
export const GET = orgRute({
  nivaa: "admin", modul: "ai_radgiver",
  handler: ({ db, orgId, req }) =>
    hentForbruk(db, orgId, new URL(req.url).searchParams.get("fra") ?? undefined),
});
