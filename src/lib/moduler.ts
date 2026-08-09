/**
 * Hvilke moduler en organisasjon har aktivert. Port av `backend/app/module_access.py`.
 *
 * I v1 lå denne lista to steder — her og i `frontend/src/moduleRegistry.js` — med en
 * kommentar øverst i begge om at de MÅ endres samtidig. Gjorde man det ikke, så kunden en
 * modul i menyen som API-et nektet, eller omvendt. I v2 er det én fil, og både menyen og
 * gaten leser den. Det er en av de konkrete gevinstene ved å ha ett språk.
 */

/** Alle modulnøkler, i visningsrekkefølge. */
export const ALLE_MODULER = [
  "dashboard",
  "tasks",
  "avvik",
  "kontrakter",
  "internkontroll",
  "driftslogg",
  "parkering",
  "arshjul",
  "dokumentarkiv",
  "vedlikehold",
  "ai_radgiver",
  "rutiner",
  "leverandorer",
  "brukere",
] as const;

export type ModulNokkel = (typeof ALLE_MODULER)[number];

/**
 * Moduler som IKKE skal dukke opp automatisk hos eksisterende kunder — de uten en egen
 * lagret modulliste. Tilsvarer `defaultOff: true` i v1s register.
 */
export const AV_SOM_STANDARD: ReadonlySet<ModulNokkel> = new Set([
  "internkontroll",
  "driftslogg",
  "parkering",
  "arshjul",
  "dokumentarkiv",
  "vedlikehold",
  "ai_radgiver",
  "rutiner",
]);

export const PA_SOM_STANDARD: readonly ModulNokkel[] = ALLE_MODULER.filter(
  (k) => !AV_SOM_STANDARD.has(k),
);

/**
 * Nøkler som tidligere var egne moduler, nå slått sammen under én forelder — eller som bare
 * har skiftet navn. Kunder med en eksplisitt liste fra før endringen har ikke den nye nøkkelen
 * lagret; uten dette ville modulen blitt låst ute for dem.
 */
export const GAMLE_ALIASER: Readonly<Partial<Record<ModulNokkel, readonly string[]>>> = {
  internkontroll: ["risikovurdering", "vernerunde", "hms_maal"],
  vedlikehold: ["vedlikeholdsplan"],
};

/** Dashboard kan ikke slås av, og gates derfor ikke. */
export const ALLTID_PA: ReadonlySet<ModulNokkel> = new Set(["dashboard"]);

/**
 * Tom eller ugyldig `enabledModules` betyr «ingen egen liste» ⇒ bruk standardsettet.
 *
 * Merk at feiltolkning faller tilbake til standardsettet og ikke til «alt av». En kunde som
 * har fått en ødelagt JSON-verdi i basen skal ikke miste hele appen — de skal se det samme
 * som en ny kunde ser.
 */
export function modulErAktivert(lagret: string | null | undefined, nokkel: ModulNokkel): boolean {
  if (ALLTID_PA.has(nokkel)) return true;
  if (!lagret) return PA_SOM_STANDARD.includes(nokkel);

  let aktiverte: unknown;
  try {
    aktiverte = JSON.parse(lagret);
  } catch {
    return PA_SOM_STANDARD.includes(nokkel);
  }
  if (!Array.isArray(aktiverte)) return PA_SOM_STANDARD.includes(nokkel);

  if (aktiverte.includes(nokkel)) return true;
  return (GAMLE_ALIASER[nokkel] ?? []).some((alias) => aktiverte.includes(alias));
}
