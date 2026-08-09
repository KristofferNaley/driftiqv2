import { lesKropp, orgRute } from "@/lib/api";
import { opprettTiltak, tiltakInn } from "@/lib/internkontroll";

export const POST = orgRute({
  nivaa: "redigering", modul: "internkontroll",
  handler: async ({ db, orgId, req }) => opprettTiltak(db, orgId, await lesKropp(req, tiltakInn)),
});
