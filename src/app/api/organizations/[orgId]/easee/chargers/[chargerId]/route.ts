import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { kobleLaderTilPlass, laderPlassInn } from "@/lib/easeekobling";

/** Koble laderen til en parkeringsplass (eller løsne den med `spotId: null`). */
export const PATCH = orgRute<{ chargerId: string }>({
  nivaa: "redigering",
  modul: "parkering",
  handler: async ({ db, orgId, bruker, params, req }) =>
    kobleLaderTilPlass(db, orgId, aktorFor(bruker), params.chargerId, await lesKropp(req, laderPlassInn)),
});
