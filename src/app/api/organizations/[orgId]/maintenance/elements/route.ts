import { lesKropp, orgRute } from "@/lib/api";
import { elementInn, hentElementer, opprettElement } from "@/lib/vedlikehold";

export const GET = orgRute({
  nivaa: "lesing", modul: "vedlikehold",
  handler: ({ db, orgId }) => hentElementer(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, req }) => opprettElement(db, orgId, await lesKropp(req, elementInn)),
});
