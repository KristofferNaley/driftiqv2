import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { beregnSatser } from "@/lib/okonomi";

/** Regner sats per seksjon fra det vedtatte budsjettet. Overstyrte satser røres ikke. */
export const POST = orgRute<{ budgetId: string }>({
  nivaa: "admin",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => beregnSatser(db, orgId, params.budgetId, aktorFor(bruker)),
});
