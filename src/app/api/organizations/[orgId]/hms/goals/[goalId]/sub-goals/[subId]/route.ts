import { orgRute } from "@/lib/api";
import { slettDelmal } from "@/lib/internkontroll";

export const DELETE = orgRute<{ goalId: string; subId: string }>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettDelmal(db, orgId, params.goalId, params.subId),
});
