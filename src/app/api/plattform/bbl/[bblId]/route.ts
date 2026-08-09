import { lesKropp, plattformRute } from "@/lib/api";
import { bblEndring, endre, slett } from "@/lib/bbl";

export const PUT = plattformRute<{ bblId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) => endre(db, params.bblId, await lesKropp(req, bblEndring)),
});

export const DELETE = plattformRute<{ bblId: string }>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => slett(db, params.bblId),
  status: 204,
});
