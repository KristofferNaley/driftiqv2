import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { eksporterKjoring } from "@/lib/okonomi";

/** CSV-en til forretningsfører. Returnerer `Filsvar` — en rå buffer ville blitt JSON. */
export const GET = orgRute<{ runId: string }>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => eksporterKjoring(db, orgId, params.runId, aktorFor(bruker)),
});
