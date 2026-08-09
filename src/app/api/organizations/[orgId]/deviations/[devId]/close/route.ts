import { lesKropp, orgRute } from "@/lib/api";
import { lukkAvvik, lukkInn } from "@/lib/avvik";

/** Eneste vei til status `lukket`. Løsningsbeskrivelsen er påkrevd av skjemaet. */
export const POST = orgRute<{ devId: string }>({
  nivaa: "redigering",
  modul: "avvik",
  handler: async ({ db, orgId, params, req }) =>
    lukkAvvik(db, orgId, params.devId, await lesKropp(req, lukkInn)),
});
