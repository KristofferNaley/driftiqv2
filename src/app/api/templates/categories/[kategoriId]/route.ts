import { lesKropp, plattformRute } from "@/lib/api";
import { endreKategori, kategoriInn, slettKategori } from "@/lib/maler";

type P = { kategoriId: string };

export const PUT = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    endreKategori(db, params.kategoriId, await lesKropp(req, kategoriInn.partial())),
});

export const DELETE = plattformRute<P>({
  nivaa: "plattformadmin", status: 204,
  handler: ({ db, params }) => slettKategori(db, params.kategoriId),
});
