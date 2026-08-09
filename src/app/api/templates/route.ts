import { lesKropp, plattformRute } from "@/lib/api";
import { MALTYPER, hentMaler, malInn, opprettMal, type Maltype } from "@/lib/maler";

/** Lesetilgang for alle innloggede: kunde-appen må kunne hente spørsmålslista. */
export const GET = plattformRute({
  nivaa: "alle",
  handler: ({ db, req }) => {
    const t = new URL(req.url).searchParams.get("type");
    return hentMaler(db, MALTYPER.includes(t as Maltype) ? (t as Maltype) : undefined);
  },
});

export const POST = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, req }) => opprettMal(db, await lesKropp(req, malInn)),
});
