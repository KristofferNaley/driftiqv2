import { evalueringInn, hentEvalueringer, opprettEvaluering } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentEvalueringer(db, orgId) });
export const POST = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => opprettEvaluering(db, orgId, await lesKropp(req, evalueringInn)),
});
