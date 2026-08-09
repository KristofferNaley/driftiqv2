import { orgRute } from "@/lib/api";
import { slettFraVenteliste } from "@/lib/parkering";

export const DELETE = orgRute<{ entryId: string }>({
  nivaa: "redigering",
  modul: "parkering",
  status: 204,
  handler: ({ db, orgId, params }) => slettFraVenteliste(db, orgId, params.entryId),
});
