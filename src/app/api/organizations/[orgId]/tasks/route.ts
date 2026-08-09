import { lesKropp, orgRute } from "@/lib/api";
import { hentOppgaver, oppgaveInn, opprettOppgave } from "@/lib/oppgaver";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "tasks",
  handler: ({ db, orgId }) => hentOppgaver(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "tasks",
  handler: async ({ db, orgId, req }) => opprettOppgave(db, orgId, await lesKropp(req, oppgaveInn)),
});
