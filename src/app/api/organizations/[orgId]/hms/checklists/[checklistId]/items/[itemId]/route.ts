import { endreSjekklistepunkt, sjekklistepunktEndring, slettSjekklistepunkt } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

type P = { checklistId: string; itemId: string };
export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) =>
    endreSjekklistepunkt(db, orgId, params.checklistId, params.itemId, await lesKropp(req, sjekklistepunktEndring)),
});
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettSjekklistepunkt(db, orgId, params.checklistId, params.itemId),
});
