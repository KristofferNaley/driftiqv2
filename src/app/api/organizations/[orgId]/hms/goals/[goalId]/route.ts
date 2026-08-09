import { lesKropp, orgRute } from "@/lib/api";
import { endreMal, hentEttMal, malEndring, slettMal } from "@/lib/internkontroll";

type P = { goalId: string };
export const GET = orgRute<P>({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId, params }) => hentEttMal(db, orgId, params.goalId) });
export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) => endreMal(db, orgId, params.goalId, await lesKropp(req, malEndring)),
});
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettMal(db, orgId, params.goalId),
});
