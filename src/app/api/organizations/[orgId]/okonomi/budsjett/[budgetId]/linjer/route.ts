import { lesKropp, orgRute } from "@/lib/api";
import { leggTilLinje, linjeInn } from "@/lib/okonomi";

export const POST = orgRute<{ budgetId: string }>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) =>
    leggTilLinje(db, orgId, params.budgetId, await lesKropp(req, linjeInn)),
});
