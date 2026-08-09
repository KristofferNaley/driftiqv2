import { lesKropp, plattformRute } from "@/lib/api";
import { leggTilPunkt, punktInn } from "@/lib/maler";

export const POST = plattformRute<{ kategoriId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    leggTilPunkt(db, params.kategoriId, await lesKropp(req, punktInn)),
});
