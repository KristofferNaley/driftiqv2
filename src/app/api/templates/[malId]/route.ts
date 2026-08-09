import { lesKropp, plattformRute } from "@/lib/api";
import { endreMal, hentMal, malEndring, slettMal } from "@/lib/maler";

type P = { malId: string };

export const GET = plattformRute<P>({
  nivaa: "alle",
  handler: ({ db, params }) => hentMal(db, params.malId),
});

export const PUT = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) => endreMal(db, params.malId, await lesKropp(req, malEndring)),
});

export const DELETE = plattformRute<P>({
  nivaa: "plattformadmin", status: 204,
  handler: ({ db, params }) => slettMal(db, params.malId),
});
