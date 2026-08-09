import { lesKropp, orgRute } from "@/lib/api";
import { arbeidEndring, endreArbeid, hentArbeid, slettArbeid } from "@/lib/vedlikehold";

type P = { workId: string };

export const GET = orgRute<P>({
  nivaa: "lesing", modul: "vedlikehold",
  handler: ({ db, orgId, params }) => hentArbeid(db, orgId, params.workId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, params, req }) =>
    endreArbeid(db, orgId, params.workId, await lesKropp(req, arbeidEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "vedlikehold", status: 204,
  handler: ({ db, orgId, params }) => slettArbeid(db, orgId, params.workId),
});
