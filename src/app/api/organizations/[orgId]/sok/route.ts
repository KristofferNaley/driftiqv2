import { orgRute, ugyldig } from "@/lib/api";
import { hentGlobaltSok, sokSkjema } from "@/lib/sok";

/**
 * Globalt søk. UTEN `modul:` — det tredje legitime unntaket, ved siden av org-metadata og
 * brukerlisten: søket går på tvers av modulene, og gaten ligger i stedet INNE i
 * `hentGlobaltSok`, som hopper over tabellene til moduler kunden ikke har. En rute med
 * `modul:` her måtte valgt ÉN modul å gate på, og det finnes ingen riktig kandidat.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: async ({ db, orgId, req }) => {
    // safeParse, ikke parse: en for kort q er 400 med norsk melding, ikke en 500.
    const inn = sokSkjema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!inn.success) throw ugyldig(inn.error.issues[0]?.message ?? "Ugyldig søk");
    return hentGlobaltSok(db, orgId, inn.data.q);
  },
});
