import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { blokkInn, hentBlokker, opprettBlokk } from "@/lib/tavleblokker";

/** Innholdsblokker med egne innstillinger — vær og avganger (docs/entur-yr.md). */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentBlokker(db, orgId),
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, bruker, req }) => opprettBlokk(db, orgId, aktorFor(bruker), await lesKropp(req, blokkInn)),
});
