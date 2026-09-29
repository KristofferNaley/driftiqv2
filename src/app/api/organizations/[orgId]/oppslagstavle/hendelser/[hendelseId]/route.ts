import { orgRute } from "@/lib/api";
import { slettHendelse } from "@/lib/oppslagstavle";

export const DELETE = orgRute<{ hendelseId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  status: 204,
  handler: ({ db, orgId, params }) => slettHendelse(db, orgId, params.hendelseId),
});
