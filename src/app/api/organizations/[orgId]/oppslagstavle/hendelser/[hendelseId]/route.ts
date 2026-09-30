import { lesKropp, orgRute } from "@/lib/api";
import { endreHendelse, hendelseInn, slettHendelse } from "@/lib/oppslagstavle";

export const PUT = orgRute<{ hendelseId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) =>
    endreHendelse(db, orgId, params.hendelseId, await lesKropp(req, hendelseInn)),
});

export const DELETE = orgRute<{ hendelseId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  status: 204,
  handler: ({ db, orgId, params }) => slettHendelse(db, orgId, params.hendelseId),
});
