import { lesKropp, orgRute } from "@/lib/api";
import { erstattSjekkliste, sjekklisteInn } from "@/lib/oppgaver";

export const PUT = orgRute<{ taskId: string }>({
  nivaa: "redigering",
  modul: "tasks",
  handler: async ({ db, orgId, params, req }) =>
    erstattSjekkliste(db, orgId, params.taskId, await lesKropp(req, sjekklisteInn)),
});
