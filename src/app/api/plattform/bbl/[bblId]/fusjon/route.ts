import { lesKropp, plattformRute } from "@/lib/api";
import { avlysFusjon, fusjonInn, varsleFusjon } from "@/lib/bbl";

export const POST = plattformRute<{ bblId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    varsleFusjon(db, params.bblId, await lesKropp(req, fusjonInn)),
});

export const DELETE = plattformRute<{ bblId: string }>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => avlysFusjon(db, params.bblId),
});
