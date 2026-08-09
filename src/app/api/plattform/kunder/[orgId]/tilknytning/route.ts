import { lesKropp, plattformRute } from "@/lib/api";
import { settTilknytning, tilknytningEndring } from "@/lib/kundedetalj";

export const PUT = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    settTilknytning(db, params.orgId, await lesKropp(req, tilknytningEndring)),
});
