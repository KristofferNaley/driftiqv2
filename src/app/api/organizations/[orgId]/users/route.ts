import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { hentBrukere, inviterBruker, inviterInn, sendOppsettEpost } from "@/lib/brukere";

/**
 * `nivaa: "lesing"` på lista: hvem som sitter i styret er ikke hemmelig for de andre i
 * laget, og oppgaver og avvik viser uansett navnene deres.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId }) => hentBrukere(db, orgId),
});

/**
 * Inviterer en bruker og sender velkomstlenken.
 *
 * E-posten går gjennom `etterCommit`, ikke inne i handleren: Better Auth slår opp adressen
 * på en annen tilkobling, og inne i transaksjonen finnes ikke raden for den ennå. Symptomet
 * var «Reset Password: User not found» — brukeren ble opprettet, men fikk aldri e-posten.
 *
 * Bare NYE kontoer får den. En som allerede har konto og bare får tilgang til ett lag til,
 * har et passord fra før og skal ikke bli bedt om å sette opp kontoen sin på nytt.
 */
export const POST = orgRute({
  nivaa: "admin",
  handler: async ({ db, orgId, bruker, req, etterCommit }) => {
    const data = await lesKropp(req, inviterInn);
    const resultat = await inviterBruker(db, orgId, data, aktorFor(bruker));
    if (resultat.nyKonto) etterCommit(() => sendOppsettEpost(data.email));
    return resultat;
  },
});
