import { orgRute } from "@/lib/api";
import { hentLading } from "@/lib/easeekobling";

/**
 * Lading-fanen: laderne med tilstand, plass og månedsforbruk. GET frisker opp det som er
 * gammelt; POST («Oppdater fra Easee») henter laderliste, tilstand og forbruk på nytt.
 */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId }) => hentLading(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "parkering",
  handler: ({ db, orgId }) => hentLading(db, orgId, { frisk: "alt" }),
});
