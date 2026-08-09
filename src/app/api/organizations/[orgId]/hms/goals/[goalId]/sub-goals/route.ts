import { delmalInn, leggTilDelmal } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const POST = orgRute<{ goalId: string }>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) => leggTilDelmal(db, orgId, params.goalId, await lesKropp(req, delmalInn)),
});
