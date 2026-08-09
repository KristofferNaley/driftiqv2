import { lesKropp, plattformRute } from "@/lib/api";
import { hentPrismodell, settVarselmottakere, varselmottakereInn } from "@/lib/prismodell";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db }) => (await hentPrismodell(db)).varselmottakere,
});

export const PUT = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, req }) =>
    settVarselmottakere(db, (await lesKropp(req, varselmottakereInn)).epostadresser),
});
