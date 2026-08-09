import { orgRute } from "@/lib/api";
import { hentDashbord } from "@/lib/dashbord";

/**
 * Alt dashbordet trenger, i ett kall.
 *
 * Ingen `modul`-gate på ruta selv: dashbordet er `alltid på` og skal fungere uansett hvilke
 * moduler kunden har. Gatingen skjer per felt inne i `hentDashbord` — en avslått modul gir
 * `null`, og widgeten tegnes ikke.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId }) => hentDashbord(db, orgId),
});
