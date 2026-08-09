import { lesKropp, orgRute } from "@/lib/api";
import { hentVarsler, settVarsler, varselOppdatering } from "@/lib/varsler";

/**
 * Egne varsler. Krever INGEN admin-tilgang — det er dine e-poster, og en visningsbruker
 * skal kunne skru av en påminnelse uten å spørre styret om lov.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId, bruker }) => hentVarsler(db, orgId, bruker.id),
});

export const PUT = orgRute({
  nivaa: "lesing",
  handler: async ({ db, orgId, bruker, req }) =>
    settVarsler(db, orgId, bruker.id, (await lesKropp(req, varselOppdatering)).prefs),
});
