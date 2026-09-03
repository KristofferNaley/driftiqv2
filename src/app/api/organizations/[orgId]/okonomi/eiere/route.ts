import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { eierInn, hentEiere, registrerEier } from "@/lib/okonomi";

/**
 * Eierregisteret. Personopplysninger — derfor `admin` for alt som skriver, og lesing for
 * alle med modulen (styret må kunne slå opp hvem som eier seksjon 12).
 */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId }) => hentEiere(db, orgId),
});

/** Ny eier — eierskifte når seksjonen alt har en. */
export const POST = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, req }) =>
    registrerEier(db, orgId, aktorFor(bruker), await lesKropp(req, eierInn)),
});
