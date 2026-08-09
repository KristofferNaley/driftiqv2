import { lesKropp, orgRute } from "@/lib/api";
import { registrerUtkvittering, utkvitteringInn } from "@/lib/oppgaver";

export const POST = orgRute<{ taskId: string }>({
  nivaa: "redigering",
  modul: "tasks",
  handler: async ({ db, orgId, params, bruker, req }) =>
    registrerUtkvittering(db, orgId, params.taskId, bruker.name, await lesKropp(req, utkvitteringInn)),
});
