import { lesKropp, orgRute } from "@/lib/api";
import { endreLinje, linjeEndring, slettLinje } from "@/lib/okonomi";

type P = { budgetId: string; lineId: string };

export const PUT = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) =>
    endreLinje(db, orgId, params.budgetId, params.lineId, await lesKropp(req, linjeEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  status: 204,
  handler: ({ db, orgId, params }) => slettLinje(db, orgId, params.budgetId, params.lineId),
});
