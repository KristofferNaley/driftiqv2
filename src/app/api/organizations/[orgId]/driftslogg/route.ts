import { lesKropp, orgRute } from "@/lib/api";
import { hentLogg, loggInn, opprettLogg } from "@/lib/driftslogg";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "driftslogg",
  handler: ({ db, orgId }) => hentLogg(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "driftslogg",
  // Forfatternavnet kopieres inn ved skriving — se kommentaren på `logEntries.createdBy`.
  handler: async ({ db, orgId, bruker, req }) =>
    opprettLogg(db, orgId, bruker.name, await lesKropp(req, loggInn)),
});
