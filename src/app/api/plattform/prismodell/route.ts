import { lesKropp, plattformRute } from "@/lib/api";
import { hentPrismodell, prismodellInn, settPrismodell } from "@/lib/prismodell";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentPrismodell(db),
});

export const PUT = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, req }) => settPrismodell(db, await lesKropp(req, prismodellInn)),
});
