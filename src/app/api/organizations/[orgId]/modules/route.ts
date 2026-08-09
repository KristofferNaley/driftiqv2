import { lesKropp, orgRute } from "@/lib/api";
import { modulValg, settModuler } from "@/lib/organisasjon";

/** Modulvalg er kontooppsett — krever orgadmin. */
export const PUT = orgRute({
  nivaa: "admin",
  handler: async ({ db, orgId, req }) => {
    const { moduler } = await lesKropp(req, modulValg);
    return settModuler(db, orgId, moduler);
  },
});
