import { lesKropp, orgRute } from "@/lib/api";
import { lukkAvvik, lukkInn } from "@/lib/avvik";
import { aktorFor } from "@/lib/aktor";

/** Eneste vei til status `lukket`. Løsningsbeskrivelsen er påkrevd av skjemaet. */
export const POST = orgRute<{ devId: string }>({
  nivaa: "redigering",
  modul: "avvik",
  handler: async ({ db, orgId, bruker, params, req }) =>
    lukkAvvik(db, orgId, params.devId, aktorFor(bruker), await lesKropp(req, lukkInn)),
});
