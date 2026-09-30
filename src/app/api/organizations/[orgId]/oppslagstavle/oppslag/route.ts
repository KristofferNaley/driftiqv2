import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { hentOppslag, oppslagInn, opprettOppslag } from "@/lib/oppslagstavle";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentOppslag(db, orgId),
});

/** Tekstoppslag. Bildeoppslag begynner som kladd (`oppslag/kladd`) og får filene én og én. */
export const POST = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, bruker, req }) =>
    opprettOppslag(db, orgId, aktorFor(bruker), await lesKropp(req, oppslagInn)),
});
