import { lesKropp, orgRute } from "@/lib/api";
import { hentOppgaver, oppgaveInn, opprettOppgave } from "@/lib/oppgaver";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "tasks",
  // `?deaktiverte=1` tar med de avsluttede. Uten den er de ute — se hentOppgaver.
  handler: ({ db, orgId, req }) =>
    hentOppgaver(db, orgId, {
      inkluderDeaktiverte: new URL(req.url).searchParams.has("deaktiverte"),
    }),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "tasks",
  handler: async ({ db, orgId, req }) => opprettOppgave(db, orgId, await lesKropp(req, oppgaveInn)),
});
