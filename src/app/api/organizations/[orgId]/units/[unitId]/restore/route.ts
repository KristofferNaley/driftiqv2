import { orgRute } from "@/lib/api";
import { gjenopprettEnhet } from "@/lib/enheter";

export const POST = orgRute<{ unitId: string }>({
  nivaa: "redigering",
  handler: ({ db, orgId, params }) => gjenopprettEnhet(db, orgId, params.unitId),
});
