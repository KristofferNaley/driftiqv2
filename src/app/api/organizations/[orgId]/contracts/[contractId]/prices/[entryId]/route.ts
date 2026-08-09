import { orgRute } from "@/lib/api";
import { slettPris } from "@/lib/kontrakter";

export const DELETE = orgRute<{ contractId: string; entryId: string }>({
  nivaa: "redigering",
  modul: "kontrakter",
  status: 204,
  handler: ({ db, orgId, params }) => slettPris(db, orgId, params.contractId, params.entryId),
});
