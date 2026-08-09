import { lesKropp, orgRute } from "@/lib/api";
import { hentVenteliste, leggPaVenteliste, ventelisteInn } from "@/lib/parkering";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId }) => hentVenteliste(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "parkering",
  handler: async ({ db, orgId, req }) =>
    leggPaVenteliste(db, orgId, await lesKropp(req, ventelisteInn)),
});
