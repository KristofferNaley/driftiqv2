/**
 * Tilgangsnivåene i én organisasjon. **Ingen importer** — med vilje.
 *
 * Verdien er `orgadmin` i API og database, men vises som «Kontoadmin». Kodenavnet er
 * bevisst et annet enn etiketten: i koden må nivået ikke kunne forveksles med DriftIQs egne
 * plattformroller (`superadmin`, `kontoansvarlig`), mens kunden bare ser sin egen
 * organisasjon — og der er «Kontoadmin» det naturlige ordet.
 *
 * ## Hvorfor dette ligger i en EGEN fil
 *
 * Etikettene trengs både på serveren og i nettleseren. La de i `lib/brukere.ts`, som
 * importerer databaseklienten, dro en `"use client"`-side hele `pg`-driveren inn i
 * nettleserbundlet — og bygget feilet med «Module not found: Can't resolve 'dns'».
 *
 * Verken `tsc --noEmit` eller lint ser det: begge nøyer seg med at importen finnes.
 * Regelen er derfor: **alt en klientkomponent trenger, må ligge i en fil uten
 * server-importer.** Samme grunn som at `oppgaveregler.ts` er ren.
 */

export const NIVAER = ["orgadmin", "redigering", "visning"] as const;

export type Nivaa = (typeof NIVAER)[number];

export const TILGANGSNIVAER = [
  {
    verdi: "orgadmin",
    etikett: "Kontoadmin",
    beskrivelse: "Alt i driftsmodulene + Brukere, Innstillinger og Fakturering.",
  },
  {
    verdi: "redigering",
    etikett: "Redigering",
    beskrivelse: "Opprette, endre og kvittere ut i alle driftsmoduler. Ser ikke kontosidene.",
  },
  {
    verdi: "visning",
    etikett: "Visning",
    beskrivelse: "Ser alt innhold og kan melde avvik, men endrer ingenting.",
  },
] as const;

export const NIVA_ETIKETT: Record<string, string> = Object.fromEntries(
  TILGANGSNIVAER.map((n) => [n.verdi, n.etikett]),
);

/** Fargen nivåprikken får i lister. */
export const NIVA_FARGE: Record<string, string> = {
  orgadmin: "var(--accent2)",
  redigering: "var(--accent)",
  visning: "var(--muted)",
};
