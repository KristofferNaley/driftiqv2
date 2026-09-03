import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { hentKjoringer, kjoringInn, opprettKjoring } from "@/lib/okonomi";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId }) => hentKjoringer(db, orgId),
});

/** Halvårskjøringen — lager fakturagrunnlaget. */
export const POST = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, req }) =>
    opprettKjoring(db, orgId, aktorFor(bruker), await lesKropp(req, kjoringInn)),
});
