import { hentSjekklister, opprettSjekkliste, sjekklisteInn } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentSjekklister(db, orgId) });

/** `templateId` kopierer punktene fra en standardmal inn som lagets egne. */
export const POST = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => opprettSjekkliste(db, orgId, await lesKropp(req, sjekklisteInn)),
});
