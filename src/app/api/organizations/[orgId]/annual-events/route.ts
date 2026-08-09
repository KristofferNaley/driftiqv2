import { lesKropp, orgRute } from "@/lib/api";
import { hendelseInn, hentHendelser, opprettHendelse } from "@/lib/arshjul";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "arshjul",
  handler: ({ db, orgId }) => hentHendelser(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "arshjul",
  handler: async ({ db, orgId, req }) =>
    opprettHendelse(db, orgId, await lesKropp(req, hendelseInn)),
});
