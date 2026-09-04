import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { kobleTilMedNokkel, nokkelInn } from "@/lib/fikenkobling";

/**
 * KUN testmiljøet: kobler med personlig API-nøkkel mot demoforetaket. I prod svarer
 * lib-funksjonen 404 — Fikens vilkår forbyr personlig nøkkel i en tredjepartsapp.
 * Nøkkelen krypteres før den lagres og logges aldri.
 */
export const POST = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, req }) =>
    kobleTilMedNokkel(db, orgId, aktorFor(bruker), await lesKropp(req, nokkelInn)),
});
