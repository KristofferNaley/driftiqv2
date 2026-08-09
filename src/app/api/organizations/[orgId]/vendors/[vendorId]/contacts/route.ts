import { lesKropp, orgRute } from "@/lib/api";
import { kontaktInn, leggTilKontakt } from "@/lib/leverandorer";

export const POST = orgRute<{ vendorId: string }>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, params, req }) =>
    leggTilKontakt(db, orgId, params.vendorId, await lesKropp(req, kontaktInn)),
});
