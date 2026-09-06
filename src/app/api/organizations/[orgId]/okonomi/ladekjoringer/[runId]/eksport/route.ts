import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { eksporterLadekjoring } from "@/lib/ladekjoring";

/** CSV av ladekjøringen — til forretningsfører eller regneark. Logges. */
export const GET = orgRute<{ runId: string }>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => eksporterLadekjoring(db, orgId, params.runId, aktorFor(bruker)),
});
