import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { gjenapneBudsjett, vedtaBudsjett, vedtakInn } from "@/lib/okonomi";

type P = { budgetId: string };

/** Vedtar — låser linjene. DELETE gjenåpner. Begge logges. */
export const POST = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, params, req }) =>
    vedtaBudsjett(db, orgId, params.budgetId, aktorFor(bruker), await lesKropp(req, vedtakInn)),
});

export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => gjenapneBudsjett(db, orgId, params.budgetId, aktorFor(bruker)),
});
