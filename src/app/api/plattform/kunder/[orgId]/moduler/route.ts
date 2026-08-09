import { lesKropp, plattformRute } from "@/lib/api";
import { modulEndring, settModuler } from "@/lib/kundedetalj";

/**
 * Modulvalget for én kunde. Ligger HER og ikke under /organizations: en kontoadmin som
 * kunne skru på en betalt modul selv, ville fått den gratis.
 */
export const PUT = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    settModuler(db, params.orgId, (await lesKropp(req, modulEndring)).moduler),
});
