import { orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { byggEksport } from "@/lib/eksport";
import { loggHendelse } from "@/lib/hendelser";

/**
 * «Last ned komplett arkiv» under Innstillinger → Generelt. `admin`: uttaket er HELE lagets
 * datagrunnlag i én fil — backup, revisjon eller flytting ut av DriftIQ — og hvem som tar
 * det ut er et adminvalg, som i v1.
 *
 * Eneste LESING som havner i hendelsesloggen: et fullt uttak av kundens data er
 * revisjonsverdig i seg selv. Se `lib/hendelser.ts`.
 */
export const GET = orgRute({
  nivaa: "admin",
  handler: async ({ db, orgId, bruker }) => {
    await loggHendelse(db, orgId, aktorFor(bruker), {
      modul: "org",
      entitet: "eksport",
      hendelse: "Tok full dataeksport",
    });
    return byggEksport(db, orgId);
  },
});
