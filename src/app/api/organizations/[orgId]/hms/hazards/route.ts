import { fareInn, hentFarer, opprettFare } from "@/lib/internkontroll";
import { lesKropp, orgRute } from "@/lib/api";

export const GET = orgRute({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId }) => hentFarer(db, orgId) });
export const POST = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => opprettFare(db, orgId, await lesKropp(req, fareInn)),
});
