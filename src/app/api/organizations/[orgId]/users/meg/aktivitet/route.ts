import { orgRute } from "@/lib/api";
import { hentMinAktivitet } from "@/lib/aktivitet";

/**
 * Egen aktivitet. `nivaa: "lesing"` — dette er din egen historikk, og en visningsbruker som
 * har meldt et avvik skal kunne se at de gjorde det.
 *
 * Ingen `modul:`-gate: fanen går på tvers av moduler, og en modul som slås av skal ikke
 * slette det du gjorde mens den var på. Se filkommentaren i lib/aktivitet.ts.
 *
 * Brukeren kommer fra ØKTEN, ikke fra URL-en. Det er ingen `[brukerId]`-variant av denne
 * ruta med vilje: «hva har Kari gjort» er et annet spørsmål, med et annet personvernsvar, og
 * det skal i så fall besvares bevisst — ikke ved at noen bytter ut `meg` med en id.
 */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId, bruker }) => hentMinAktivitet(db, orgId, bruker),
});
