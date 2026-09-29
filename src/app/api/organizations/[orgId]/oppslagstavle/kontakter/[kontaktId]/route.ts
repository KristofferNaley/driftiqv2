import { lesKropp, orgRute } from "@/lib/api";
import { endreKontakt, kontaktEndring, slettKontakt } from "@/lib/oppslagstavle";

export const PUT = orgRute<{ kontaktId: string }>({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) =>
    endreKontakt(db, orgId, params.kontaktId, await lesKropp(req, kontaktEndring)),
});

export const DELETE = orgRute<{ kontaktId: string }>({
  nivaa: "admin",
  modul: "oppslagstavle",
  status: 204,
  handler: ({ db, orgId, params }) => slettKontakt(db, orgId, params.kontaktId),
});
