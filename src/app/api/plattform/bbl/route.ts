import { lesKropp, plattformRute } from "@/lib/api";
import { bblInn, hentAlle, opprett } from "@/lib/bbl";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentAlle(db),
});

export const POST = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, req }) => opprett(db, await lesKropp(req, bblInn)),
  status: 201,
});
