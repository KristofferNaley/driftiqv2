import { lesKropp, orgRute } from "@/lib/api";
import { hentRutiner, opprettRutine, rutineInn } from "@/lib/rutiner";

export const GET = orgRute({
  nivaa: "lesing", modul: "rutiner",
  handler: ({ db, orgId }) => hentRutiner(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering", modul: "rutiner",
  handler: async ({ db, orgId, req }) => opprettRutine(db, orgId, await lesKropp(req, rutineInn)),
});
