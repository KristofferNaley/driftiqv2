import { lesKropp, orgRute } from "@/lib/api";
import { arkiverEnhet, endreEnhet, enhetEndring } from "@/lib/enheter";

type P = { unitId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering",
  handler: async ({ db, orgId, params, req }) =>
    endreEnhet(db, orgId, params.unitId, await lesKropp(req, enhetEndring)),
});

/** DELETE arkiverer og sletter aldri — derfor svarer den med enheten, ikke 204. */
export const DELETE = orgRute<P>({
  nivaa: "redigering",
  handler: ({ db, orgId, params }) => arkiverEnhet(db, orgId, params.unitId),
});
