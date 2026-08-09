import { endreEvaluering, evalueringEndring, slettEvaluering } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

type P = { evalId: string };
export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) => endreEvaluering(db, orgId, params.evalId, await lesKropp(req, evalueringEndring)),
});
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettEvaluering(db, orgId, params.evalId),
});
