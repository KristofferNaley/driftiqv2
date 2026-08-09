import { lesKropp, orgRute } from "@/lib/api";
import { endrePlass, plassEndring, slettPlass } from "@/lib/parkering";

type P = { spotId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "parkering",
  handler: async ({ db, orgId, params, req }) =>
    endrePlass(db, orgId, params.spotId, await lesKropp(req, plassEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "parkering",
  status: 204,
  handler: ({ db, orgId, params }) => slettPlass(db, orgId, params.spotId),
});
