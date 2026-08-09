import { lesKropp, plattformRute } from "@/lib/api";
import { endrePunkt, punktInn, slettPunkt } from "@/lib/maler";

type P = { punktId: string };

export const PUT = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) => endrePunkt(db, params.punktId, await lesKropp(req, punktInn.partial())),
});

export const DELETE = plattformRute<P>({
  nivaa: "plattformadmin", status: 204,
  handler: ({ db, params }) => slettPunkt(db, params.punktId),
});
