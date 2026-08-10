import { lesKropp, orgRute } from "@/lib/api";
import { hentDriftsloggSamlet, loggInn, opprettLogg } from "@/lib/driftslogg";
import { aktorFor } from "@/lib/aktor";

/**
 * Den SAMLEDE loggen — oppgaver, avvik, vedlikehold, vernerunder og notater i én tidslinje.
 * De manuelle notatene alene serveres ikke lenger her; dashbordets «Siste aktivitet» leser
 * dem direkte via `hentLogg` på serversiden.
 */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "driftslogg",
  handler: ({ db, orgId }) => hentDriftsloggSamlet(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "driftslogg",
  // Forfatternavnet kopieres inn ved skriving — se kommentaren på `logEntries.createdBy`.
  handler: async ({ db, orgId, bruker, req }) =>
    opprettLogg(db, orgId, aktorFor(bruker), await lesKropp(req, loggInn)),
});
