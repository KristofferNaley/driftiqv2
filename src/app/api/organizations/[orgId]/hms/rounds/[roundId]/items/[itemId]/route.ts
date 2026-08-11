import { endrePunkt, punktEndring, slettPunkt } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const PUT = orgRute<{ roundId: string; itemId: string }>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) =>
    endrePunkt(db, orgId, params.roundId, params.itemId, await lesKropp(req, punktEndring)),
});

export const DELETE = orgRute<{ roundId: string; itemId: string }>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettPunkt(db, orgId, params.roundId, params.itemId),
});
