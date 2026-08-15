import { lesKropp, orgRute } from "@/lib/api";
import { opprettSerie, serieInn } from "@/lib/parkering";

/** P01–P24 i én operasjon — alt eller ingenting, se `opprettSerie`. */
export const POST = orgRute({
  nivaa: "redigering",
  modul: "parkering",
  handler: async ({ db, orgId, req }) => opprettSerie(db, orgId, await lesKropp(req, serieInn)),
});
