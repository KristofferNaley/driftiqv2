import { kategoriInn, leggTilKategori } from "@/lib/maler";
import { lesKropp, plattformRute } from "@/lib/api";

export const POST = plattformRute<{ malId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    leggTilKategori(db, params.malId, await lesKropp(req, kategoriInn)),
});
