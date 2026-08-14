import { endreSjekkliste, hentSjekkliste, sjekklisteEndring, slettSjekkliste } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

type P = { checklistId: string };
export const GET = orgRute<P>({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId, params }) => hentSjekkliste(db, orgId, params.checklistId) });
export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, params, req }) => endreSjekkliste(db, orgId, params.checklistId, await lesKropp(req, sjekklisteEndring)),
});
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettSjekkliste(db, orgId, params.checklistId),
});
