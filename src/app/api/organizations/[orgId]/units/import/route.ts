import { lesKropp, orgRute } from "@/lib/api";
import { importInn, importerEnheter } from "@/lib/enheter";

/** Masseoppretting fra Kartverket-søket. `redigering`, som resten av enhetsregisteret. */
export const POST = orgRute({
  nivaa: "redigering",
  handler: async ({ db, orgId, req }) => {
    const data = await lesKropp(req, importInn);
    return importerEnheter(db, orgId, data.rader);
  },
});
