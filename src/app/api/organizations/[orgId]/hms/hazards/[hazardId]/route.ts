import { endreFare, fareEndring, slettFare } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

type P = { hazardId: string };
export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) => endreFare(db, orgId, params.hazardId, await lesKropp(req, fareEndring)),
});
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettFare(db, orgId, params.hazardId),
});
