import { lesKropp, orgRute } from "@/lib/api";
import { registrerUtkvittering, utkvitteringInn } from "@/lib/oppgaver";
import { aktorFor } from "@/lib/aktor";

export const POST = orgRute<{ taskId: string }>({
  nivaa: "redigering",
  modul: "tasks",
  handler: async ({ db, orgId, params, bruker, req }) =>
    registrerUtkvittering(db, orgId, params.taskId, aktorFor(bruker), await lesKropp(req, utkvitteringInn)),
});
