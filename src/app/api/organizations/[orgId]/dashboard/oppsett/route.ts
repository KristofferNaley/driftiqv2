import { lesKropp, orgRute } from "@/lib/api";
import { hentOppsett, oppsettInn, settOppsett } from "@/lib/dashbordoppsett";

/**
 * Dashbordoppsettet for DEN INNLOGGEDE brukeren i denne org-en.
 *
 * `nivaa: "lesing"` også på skriving — dette er ikke kundens data, det er hvordan denne
 * personen vil se sin egen forside. En med visningstilgang skal kunne flytte på sine egne
 * widgets uten å kunne endre noe andre ser.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId, bruker }) => hentOppsett(db, orgId, bruker.id),
});

export const PUT = orgRute({
  nivaa: "lesing",
  handler: async ({ db, orgId, bruker, req }) =>
    settOppsett(db, orgId, bruker.id, (await lesKropp(req, oppsettInn)).widgets),
});
