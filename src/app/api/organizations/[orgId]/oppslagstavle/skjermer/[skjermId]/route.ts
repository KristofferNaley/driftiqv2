import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { endreSkjerm, skjermEndring, slettSkjerm } from "@/lib/oppslagstavle";

export const PUT = orgRute<{ skjermId: string }>({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) =>
    endreSkjerm(db, orgId, params.skjermId, await lesKropp(req, skjermEndring)),
});

export const DELETE = orgRute<{ skjermId: string }>({
  nivaa: "admin",
  modul: "oppslagstavle",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettSkjerm(db, orgId, aktorFor(bruker), params.skjermId),
});
