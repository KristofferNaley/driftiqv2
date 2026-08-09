import { lesKropp, plattformRute } from "@/lib/api";
import { sendOppsettEpost } from "@/lib/brukere";
import { hentPlattformbrukere, opprettPlattformbruker, plattformbrukerInn } from "@/lib/plattform";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentPlattformbrukere(db),
});

/**
 * Ny plattformadmin.
 *
 * E-posten sendes RETT etter innsettingen, ikke via `etterCommit` som i orgRute: `withoutRls`
 * er ingen transaksjon — den låner bare en tilkobling, så raden er allerede committet når vi
 * kommer hit. Better Auth finner brukeren.
 */
export const POST = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, req }) => {
    const data = await lesKropp(req, plattformbrukerInn);
    const resultat = await opprettPlattformbruker(db, data);
    if (resultat.nyKonto) await sendOppsettEpost(resultat.epost);
    return resultat;
  },
});
