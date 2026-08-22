import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { adgangInn, leggTilAdgang } from "@/lib/leverandorer";

export const POST = orgRute<{ vendorId: string }>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, bruker, params, req }) =>
    leggTilAdgang(db, orgId, params.vendorId, await lesKropp(req, adgangInn), aktorFor(bruker)),
});
