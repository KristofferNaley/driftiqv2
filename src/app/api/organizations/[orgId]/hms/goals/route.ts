import { lesKropp, orgRute } from "@/lib/api";
import { hentMal, malInn, opprettMal } from "@/lib/internkontroll";

export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentMal(db, orgId) });
export const POST = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => opprettMal(db, orgId, await lesKropp(req, malInn)),
});
