/**
 * Parkeringsplasser. Merk hvor lite som står her: sesjon, org-kontekst, tilgangsnivå og
 * modulsjekk håndteres av `orgRute()` — de kan ikke glemmes, slik de kunne i v1 der hver
 * handler måtte kalle `require_org_access()` selv.
 */
import { lesKropp, orgRute } from "@/lib/api";
import { hentPlasser, opprettPlass, plassInn } from "@/lib/parkering";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId }) => hentPlasser(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "parkering",
  handler: async ({ db, orgId, req }) => opprettPlass(db, orgId, await lesKropp(req, plassInn)),
});
