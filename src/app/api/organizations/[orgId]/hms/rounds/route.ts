import { hentRunder, opprettRunde, rundeInn } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentRunder(db, orgId) });

/** `templateId` fyller runden med punktene fra en HMS-mal — de KOPIERES inn. */
export const POST = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => opprettRunde(db, orgId, await lesKropp(req, rundeInn)),
});
