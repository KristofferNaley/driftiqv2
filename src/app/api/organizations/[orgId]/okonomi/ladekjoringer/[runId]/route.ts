import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { annullerLadekjoring, endreLadekjoring, hentLadekjoring, ladekjoringEndring } from "@/lib/ladekjoring";

type P = { runId: string };

/** Forfall og inntektskonto på et grunnlag som ikke er sendt. */
export const PATCH = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, params, req }) => endreLadekjoring(db, orgId, params.runId, aktorFor(bruker), await lesKropp(req, ladekjoringEndring)),
});

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, params }) => hentLadekjoring(db, orgId, params.runId),
});

/** Annullerer grunnlaget — sendte kjøringer krediteres i regnskapssystemet, ikke her. */
export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => annullerLadekjoring(db, orgId, params.runId, aktorFor(bruker)),
});
