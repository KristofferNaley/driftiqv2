import { lesKropp, orgRute } from "@/lib/api";
import { deaktiverOppgave, endreOppgave, hentOppgave, oppgaveEndring } from "@/lib/oppgaver";

type P = { taskId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "tasks",
  handler: ({ db, orgId, params }) => hentOppgave(db, orgId, params.taskId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "tasks",
  handler: async ({ db, orgId, params, req }) =>
    endreOppgave(db, orgId, params.taskId, await lesKropp(req, oppgaveEndring)),
});

/** Deaktiverer, sletter aldri — derfor svarer den med oppgaven og ikke 204. */
export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "tasks",
  handler: ({ db, orgId, params }) => deaktiverOppgave(db, orgId, params.taskId),
});
