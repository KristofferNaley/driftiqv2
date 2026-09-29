import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { hentSkjermer, kobleSkjerm, koblingInn } from "@/lib/oppslagstavle";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentSkjermer(db, orgId),
});

/** Å koble en skjerm er å gi en enhet lesetilgang — og en lisens på fakturaen. Orgadmin. */
export const POST = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, bruker, req }) =>
    kobleSkjerm(db, orgId, aktorFor(bruker), await lesKropp(req, koblingInn)),
});
