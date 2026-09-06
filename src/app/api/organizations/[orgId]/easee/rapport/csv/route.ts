import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { eksporterRapport, lesMaaned } from "@/lib/easeekobling";

/** CSV av laderapporten — eksport logges i hendelsesloggen. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId, bruker, req }) => {
    const { aar, maaned } = lesMaaned(req);
    return eksporterRapport(db, orgId, aar, maaned, aktorFor(bruker));
  },
});
