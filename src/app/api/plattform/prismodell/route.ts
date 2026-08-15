import { aktorFor } from "@/lib/aktor";
import { lesKropp, plattformRute } from "@/lib/api";
import { hentPrismodellPanel, prismodellInn, settPrismodell } from "@/lib/prismodell";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentPrismodellPanel(db),
});

/** Hver lagring blir en ny versjon i historikken — se `settPrismodell`. */
export const PUT = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, req }) =>
    settPrismodell(db, await lesKropp(req, prismodellInn), aktorFor(bruker)),
});
