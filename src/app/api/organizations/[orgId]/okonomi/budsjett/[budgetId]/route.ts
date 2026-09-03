import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { budsjettEndring, endreBudsjett, hentBudsjett, slettBudsjett } from "@/lib/okonomi";

type P = { budgetId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, params }) => hentBudsjett(db, orgId, params.budgetId),
});

export const PUT = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) =>
    endreBudsjett(db, orgId, params.budgetId, await lesKropp(req, budsjettEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettBudsjett(db, orgId, params.budgetId, aktorFor(bruker)),
});
