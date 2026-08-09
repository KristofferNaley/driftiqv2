import { endreTiltak, slettTiltak, tiltakEndring } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

type P = { actionId: string };
export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) => endreTiltak(db, orgId, params.actionId, await lesKropp(req, tiltakEndring)),
});
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettTiltak(db, orgId, params.actionId),
});
