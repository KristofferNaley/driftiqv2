import { lesKropp, orgRute } from "@/lib/api";
import { behandlingInn, leggTilBehandling } from "@/lib/avvik";
import { aktorFor } from "@/lib/aktor";

/**
 * Append-only. Det finnes med vilje ingen PUT eller DELETE: behandlingsjournalen er
 * dokumentasjonskjeden som havner i internkontrollpermen, og den er bare troverdig hvis
 * innleggene står som de ble skrevet.
 */
export const POST = orgRute<{ devId: string }>({
  nivaa: "redigering",
  modul: "avvik",
  handler: async ({ db, orgId, params, bruker, req }) =>
    leggTilBehandling(db, orgId, params.devId, aktorFor(bruker), await lesKropp(req, behandlingInn)),
});
