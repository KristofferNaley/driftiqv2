import { slettSjekklistepunkt } from "@/lib/internkontroll";
import { orgRute } from "@/lib/api";

type P = { checklistId: string; itemId: string };
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettSjekklistepunkt(db, orgId, params.checklistId, params.itemId),
});
