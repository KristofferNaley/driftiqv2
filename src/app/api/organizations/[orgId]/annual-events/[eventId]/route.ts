import { lesKropp, orgRute } from "@/lib/api";
import { endreHendelse, hendelseEndring, slettHendelse } from "@/lib/arshjul";

type P = { eventId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "arshjul",
  handler: async ({ db, orgId, params, req }) =>
    endreHendelse(db, orgId, params.eventId, await lesKropp(req, hendelseEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "arshjul",
  status: 204,
  handler: ({ db, orgId, params }) => slettHendelse(db, orgId, params.eventId),
});
