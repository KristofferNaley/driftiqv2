import { orgRute } from "@/lib/api";
import { slettDeltaker } from "@/lib/internkontroll";

export const DELETE = orgRute<{ roundId: string; deltakerId: string }>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettDeltaker(db, orgId, params.roundId, params.deltakerId),
});
