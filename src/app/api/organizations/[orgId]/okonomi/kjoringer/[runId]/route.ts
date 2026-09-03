import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { annullerKjoring, hentKjoring } from "@/lib/okonomi";

type P = { runId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, params }) => hentKjoring(db, orgId, params.runId),
});

/** DELETE annullerer — raden blir stående som historikk. */
export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => annullerKjoring(db, orgId, params.runId, aktorFor(bruker)),
});
