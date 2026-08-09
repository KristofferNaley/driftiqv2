/**
 * Kategoriene på årshjulet — etiketter og farger.
 *
 * **Ingen importer.** Årshjulsiden er en klientkomponent, og hentet den disse fra
 * `arshjul.ts`, ville hele databaselaget blitt dratt inn i nettleserbundelen. Samme grunn
 * som `nivaer.ts`, `oppgaveregler.ts` og `avvikkategorier.ts` — se kommentaren der.
 *
 * Fargene brukes både til prikkene på hjulet og til legenden under, og settes inline per
 * hendelse. Derfor står de her og ikke i CSS.
 */

/** De fire kundene selv kan velge. `oppgave` og `hms` kommer fra andre moduler. */
export const KATEGORIER = ["dugnad", "budsjett", "frist", "annet"] as const;

export const HJULKATEGORIER = {
  oppgave: { etikett: "Oppgave", farge: "#4f7cff" },
  dugnad: { etikett: "Dugnad", farge: "#0fba81" },
  budsjett: { etikett: "Budsjett", farge: "#a78bfa" },
  frist: { etikett: "Frist", farge: "#f5a623" },
  hms: { etikett: "HMS", farge: "#00c2ff" },
  annet: { etikett: "Annet", farge: "#f04040" },
} as const;

export type Hjulkategori = keyof typeof HJULKATEGORIER;
