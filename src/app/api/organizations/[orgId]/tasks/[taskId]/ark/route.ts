import { orgRute } from "@/lib/api";
import { hentOppgaveark } from "@/lib/ark";

/** Alt oppslagsarket trenger, inkludert QR-koden som data-URI. Se lib/ark.ts. */
export const GET = orgRute<{ taskId: string }>({
  nivaa: "lesing",
  modul: "tasks",
  handler: ({ db, orgId, params }) => hentOppgaveark(db, orgId, params.taskId),
});
