import { lesKropp, orgRute } from "@/lib/api";
import { adgangInn, leggTilAdgang } from "@/lib/leverandorer";

export const POST = orgRute<{ vendorId: string }>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, params, req }) =>
    leggTilAdgang(db, orgId, params.vendorId, await lesKropp(req, adgangInn)),
});
