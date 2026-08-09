import { lesKropp, orgRute } from "@/lib/api";
import { leggTilNotat, notatInn } from "@/lib/leverandorer";

/** Forfatternavnet kopieres inn — historikk skal ikke endres om brukeren omdøpes. */
export const POST = orgRute<{ vendorId: string }>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, params, bruker, req }) =>
    leggTilNotat(db, orgId, params.vendorId, bruker.name, await lesKropp(req, notatInn)),
});
