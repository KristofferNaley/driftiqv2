import { lesKropp, orgRute } from "@/lib/api";
import { endreMedlemskap, fjernFraOrg, medlemEndring } from "@/lib/brukere";

type P = { brukerId: string };

export const PUT = orgRute<P>({
  nivaa: "admin",
  handler: async ({ db, orgId, bruker, params, req }) =>
    endreMedlemskap(db, orgId, params.brukerId, await lesKropp(req, medlemEndring), bruker.id),
});

/** Fjerner tilgangen til DENNE org-en. Kontoen består — brukeren kan sitte i flere styrer. */
export const DELETE = orgRute<P>({
  nivaa: "admin",
  status: 204,
  handler: ({ db, orgId, params }) => fjernFraOrg(db, orgId, params.brukerId),
});
