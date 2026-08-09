import { lesKropp, orgRute } from "@/lib/api";
import { leggTilService, serviceInn } from "@/lib/vedlikehold";

export const POST = orgRute<{ elementId: string }>({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, params, req }) =>
    leggTilService(db, orgId, params.elementId, await lesKropp(req, serviceInn)),
});
