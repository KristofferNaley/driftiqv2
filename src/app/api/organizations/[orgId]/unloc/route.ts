import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { hentKobling, kobleFra, kobleTil, koblingInn } from "@/lib/unlockobling";

/**
 * Unloc-koblingen (docs/unloc.md). Status uten hemmeligheter kan alle med modulen lese —
 * leverandørkortet trenger å vite om fanen skal vise et skjema eller en forklaring.
 * Å koble til og fra er kontoadmin: credentials gir tilgang til kundens låser.
 */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "leverandorer",
  handler: ({ db, orgId }) => hentKobling(db, orgId),
});

export const PUT = orgRute({
  nivaa: "admin",
  modul: "leverandorer",
  handler: async ({ db, orgId, bruker, req }) => kobleTil(db, orgId, aktorFor(bruker), await lesKropp(req, koblingInn)),
});

export const DELETE = orgRute({
  nivaa: "admin",
  modul: "leverandorer",
  status: 204,
  handler: ({ db, orgId, bruker }) => kobleFra(db, orgId, aktorFor(bruker)),
});
