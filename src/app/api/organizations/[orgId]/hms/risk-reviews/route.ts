import { gjennomgangInn, hentGjennomganger, opprettGjennomgang } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentGjennomganger(db, orgId) });

/** Å opprette gjennomgangen ER fullføringen — den fødes låst, med øyeblikksbilde. */
export const POST = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => opprettGjennomgang(db, orgId, await lesKropp(req, gjennomgangInn)),
});
