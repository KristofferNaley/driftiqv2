import { lesKropp, orgRute } from "@/lib/api";
import { hentBrukere, inviterBruker, inviterInn } from "@/lib/brukere";

/**
 * `nivaa: "lesing"` på lista: hvem som sitter i styret er ikke hemmelig for de andre i
 * laget, og oppgaver og avvik viser uansett navnene deres.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId }) => hentBrukere(db, orgId),
});

export const POST = orgRute({
  nivaa: "admin",
  handler: async ({ db, orgId, req }) => inviterBruker(db, orgId, await lesKropp(req, inviterInn)),
});
