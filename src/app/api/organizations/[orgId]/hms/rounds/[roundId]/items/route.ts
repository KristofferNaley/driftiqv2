import { leggTilPunkt, punktInn } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

/** Lagets egne punkter — det er slik sjekklista tilpasses bygget. Låst runde nekter. */
export const POST = orgRute<{ roundId: string }>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) =>
    leggTilPunkt(db, orgId, params.roundId, await lesKropp(req, punktInn)),
});
