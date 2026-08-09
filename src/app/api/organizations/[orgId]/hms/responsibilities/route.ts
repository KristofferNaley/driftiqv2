import { ansvarInn, hentAnsvar, settAnsvar } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

/** Alle områdene returneres alltid — et tomt område er nettopp det kunden skal se mangler. */
export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentAnsvar(db, orgId) });

export const PUT = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => settAnsvar(db, orgId, await lesKropp(req, ansvarInn)),
});
