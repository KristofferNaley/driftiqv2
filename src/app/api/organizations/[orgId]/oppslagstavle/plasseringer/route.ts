import { lesKropp, orgRute } from "@/lib/api";
import { hentPlasseringer, plasseringInn, settPlassering } from "@/lib/oppslagstavle";

/** HVOR hver blokk vises (område + skjermer) — valgt på innholdet, ikke per skjerm. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentPlasseringer(db, orgId),
});

export const PUT = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, req }) => settPlassering(db, orgId, await lesKropp(req, plasseringInn)),
});
