import { leggTilSjekklistepunkt, sjekklistepunktInn } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

type P = { checklistId: string };
export const POST = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) =>
    leggTilSjekklistepunkt(db, orgId, params.checklistId, await lesKropp(req, sjekklistepunktInn)),
});
