import { deltakerInn, leggTilDeltaker } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const POST = orgRute<{ roundId: string }>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) => leggTilDeltaker(db, orgId, params.roundId, await lesKropp(req, deltakerInn)),
});
