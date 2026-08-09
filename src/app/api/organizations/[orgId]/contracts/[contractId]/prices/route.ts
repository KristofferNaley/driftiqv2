import { lesKropp, orgRute } from "@/lib/api";
import { leggTilPris, prisInn } from "@/lib/kontrakter";

export const POST = orgRute<{ contractId: string }>({
  nivaa: "redigering",
  modul: "kontrakter",
  handler: async ({ db, orgId, params, req }) =>
    leggTilPris(db, orgId, params.contractId, await lesKropp(req, prisInn)),
});
