import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { hendelseInn, hentHendelser, opprettHendelse } from "@/lib/oppslagstavle";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentHendelser(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, bruker, req }) =>
    opprettHendelse(db, orgId, aktorFor(bruker), await lesKropp(req, hendelseInn)),
});
