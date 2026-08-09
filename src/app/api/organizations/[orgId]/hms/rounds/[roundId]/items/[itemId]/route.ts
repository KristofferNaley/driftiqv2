import { endrePunkt, punktEndring } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const PUT = orgRute<{ roundId: string; itemId: string }>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) =>
    endrePunkt(db, orgId, params.roundId, params.itemId, await lesKropp(req, punktEndring)),
});
