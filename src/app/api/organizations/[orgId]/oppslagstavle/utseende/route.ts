import { lesKropp, orgRute } from "@/lib/api";
import { hentUtseende, lagreUtseende, utseendeInn } from "@/lib/oppslagstavle";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentUtseende(db, orgId),
});

export const PUT = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, req }) => lagreUtseende(db, orgId, await lesKropp(req, utseendeInn)),
});
