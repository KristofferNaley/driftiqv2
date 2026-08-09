import { orgRute } from "@/lib/api";
import { slettLogg } from "@/lib/driftslogg";

export const DELETE = orgRute<{ entryId: string }>({
  nivaa: "redigering",
  modul: "driftslogg",
  status: 204,
  handler: ({ db, orgId, params }) => slettLogg(db, orgId, params.entryId),
});
