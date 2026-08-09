import { lesKropp, orgRute } from "@/lib/api";
import { hentVarsler, settVarsler, varselOppdatering } from "@/lib/varsler";

type P = { brukerId: string };

/**
 * Varselinnstillingene for en ANNEN bruker. Krever kontoadmin.
 *
 * Egne innstillinger går gjennom `/users/meg/varsler`, som bare krever tilgang til org-en —
 * ellers måtte et styremedlem be admin om hjelp for å skru av en e-post de ikke vil ha.
 * Den statiske ruta `meg` vinner over dette dynamiske segmentet i Next.
 */
export const GET = orgRute<P>({
  nivaa: "admin",
  handler: ({ db, orgId, params }) => hentVarsler(db, orgId, params.brukerId),
});

export const PUT = orgRute<P>({
  nivaa: "admin",
  handler: async ({ db, orgId, params, req }) =>
    settVarsler(db, orgId, params.brukerId, (await lesKropp(req, varselOppdatering)).prefs),
});
