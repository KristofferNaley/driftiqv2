import { and, count, eq, sql } from "drizzle-orm";
import { orgRute } from "@/lib/api";
import { deviations } from "@/db/schema/avvik";
import { hentOppgaver } from "@/lib/oppgaver";

/**
 * Tallene i sidemenyen: forsinkede oppgaver og åpne avvik.
 *
 * Egen, liten rute fordi sidemenyen er montert på HVER side. Å hente hele oppgave- og
 * avvikslista bare for to tall ville betydd to fulle spørringer ved hver navigasjon.
 *
 * Forsinkelsen regnes med `erForsinket` via `hentOppgaver` — samme regel som lista, siden og
 * varselsjobben. Et merke som sier «6» mens lista viser 7 er verre enn ingen merke.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: async ({ db, orgId }) => {
    const [oppgaver, avvik] = await Promise.all([
      hentOppgaver(db, orgId),
      db
        .select({ n: count() })
        .from(deviations)
        .where(and(eq(deviations.orgId, orgId), sql`${deviations.status} <> 'lukket'`)),
    ]);

    return {
      forsinkedeOppgaver: oppgaver.filter((t) => t.forsinket).length,
      apneAvvik: avvik[0]?.n ?? 0,
    };
  },
});
