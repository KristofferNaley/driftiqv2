import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { hentKobling, kobleFra, kobleTil, koblingInn } from "@/lib/easeekobling";

/**
 * Easee-koblingen (docs/easee.md). Status uten hemmeligheter kan alle med modulen lese.
 * Å koble til og fra er kontoadmin: innloggingen gir innsyn i kundens ladeanlegg.
 */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId }) => hentKobling(db, orgId),
});

export const PUT = orgRute({
  nivaa: "admin",
  modul: "parkering",
  handler: async ({ db, orgId, bruker, req }) => kobleTil(db, orgId, aktorFor(bruker), await lesKropp(req, koblingInn)),
});

export const DELETE = orgRute({
  nivaa: "admin",
  modul: "parkering",
  status: 204,
  handler: ({ db, orgId, bruker }) => kobleFra(db, orgId, aktorFor(bruker)),
});
