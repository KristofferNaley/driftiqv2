import { lesKropp, orgRute } from "@/lib/api";
import { endreSide, sideEndring, slettSide } from "@/lib/oppslagstavle";

type P = { postId: string; sideId: string };

/** Bildetekst, fokuspunkt og tilpasning. */
export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) =>
    endreSide(db, orgId, params.postId, params.sideId, await lesKropp(req, sideEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: ({ db, orgId, params }) => slettSide(db, orgId, params.postId, params.sideId),
});
