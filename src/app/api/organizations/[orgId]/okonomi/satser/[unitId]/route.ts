import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { satsInn, settSats } from "@/lib/okonomi";

/** Manuell sats for én seksjon (tillegg, avvik fra brøken). */
export const PUT = orgRute<{ unitId: string }>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, params, req }) =>
    settSats(db, orgId, params.unitId, aktorFor(bruker), await lesKropp(req, satsInn)),
});
