import { orgRute } from "@/lib/api";
import { byggEksport } from "@/lib/eksport";

/**
 * «Last ned komplett arkiv» under Innstillinger → Generelt. `admin`: uttaket er HELE lagets
 * datagrunnlag i én fil — backup, revisjon eller flytting ut av DriftIQ — og hvem som tar
 * det ut er et adminvalg, som i v1.
 */
export const GET = orgRute({
  nivaa: "admin",
  handler: ({ db, orgId }) => byggEksport(db, orgId),
});
