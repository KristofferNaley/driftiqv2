/**
 * Hvilke moduler en organisasjon har aktivert. Port av `backend/app/module_access.py`.
 *
 * I v1 lå denne lista to steder — her og i `frontend/src/moduleRegistry.js` — med en
 * kommentar øverst i begge om at de MÅ endres samtidig. Gjorde man det ikke, så kunden en
 * modul i menyen som API-et nektet, eller omvendt. I v2 er det én fil, og både menyen og
 * gaten leser den. Det er en av de konkrete gevinstene ved å ha ett språk.
 *
 * v1 hadde i tillegg en TREDJE liste: `NAV` i `Sidebar.jsx`, som bygget selve menyen.
 * Glemte du den, fikk modulen gate, rute og katalogkort — men ble usynlig i menyen når den
 * var aktivert. Her ligger menypunktet på modulen selv (`sti`, `etikett`, `gruppe`), så
 * feilen ikke kan oppstå: en modul uten sti vises ikke, og en sti uten modul finnes ikke.
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
 * Menypunktet for hver modul. Gruppene følger bruksmønster, ikke alfabet — «Daglig drift»
 * er det man er innom hver uke, «Dokumentasjon» det man er innom ved tilsyn.
 *
 * `ikon` er navnet på et lucide-ikon; komponenten slår det opp. En streng her framfor en
 * importert komponent holder denne fila fri for React, slik at rutelaget på serversiden kan
 * importere den uten å dra inn et komponentbibliotek.
 */
export type Menypunkt = { sti: string; etikett: string; gruppe: string; ikon: string };

export const MENY: Readonly<Partial<Record<ModulNokkel, Menypunkt>>> = {
  dashboard: { sti: "/", etikett: "Dashbord", gruppe: "Oversikt", ikon: "LayoutDashboard" },
  tasks: { sti: "/oppgaver", etikett: "Oppgaver", gruppe: "Daglig drift", ikon: "ClipboardCheck" },
  avvik: { sti: "/avvik", etikett: "Avvik", gruppe: "Daglig drift", ikon: "TriangleAlert" },
  driftslogg: { sti: "/driftslogg", etikett: "Driftslogg", gruppe: "Daglig drift", ikon: "NotebookPen" },
  parkering: { sti: "/parkering", etikett: "Parkering", gruppe: "Daglig drift", ikon: "SquareParking" },
  internkontroll: { sti: "/internkontroll", etikett: "Internkontroll", gruppe: "Dokumentasjon", ikon: "ShieldCheck" },
  rutiner: { sti: "/rutiner", etikett: "Rutiner", gruppe: "Dokumentasjon", ikon: "ListChecks" },
  dokumentarkiv: { sti: "/dokumentarkiv", etikett: "Dokumentarkiv", gruppe: "Dokumentasjon", ikon: "FolderOpen" },
  arshjul: { sti: "/arshjul", etikett: "Årshjul", gruppe: "Planlegging", ikon: "CalendarDays" },
  vedlikehold: { sti: "/vedlikehold", etikett: "Vedlikehold", gruppe: "Planlegging", ikon: "Wrench" },
  kontrakter: { sti: "/kontrakter", etikett: "Kontrakter", gruppe: "Leverandører", ikon: "FileText" },
  leverandorer: { sti: "/leverandorer", etikett: "Leverandører", gruppe: "Leverandører", ikon: "Truck" },
  ai_radgiver: { sti: "/ai-radgiver", etikett: "AI-rådgiver", gruppe: "Verktøy", ikon: "Sparkles" },
  brukere: { sti: "/brukere", etikett: "Brukere", gruppe: "Konto", ikon: "Users" },
};

/** Rekkefølgen gruppene vises i menyen. */
export const GRUPPER = [
  "Oversikt",
  "Daglig drift",
  "Dokumentasjon",
  "Planlegging",
  "Leverandører",
  "Verktøy",
  "Konto",
] as const;

/** Menypunktene kunden faktisk skal se, gruppert. Låste moduler faller ut. */
export function menyFor(lagret: string | null | undefined) {
  return GRUPPER.map((gruppe) => ({
    gruppe,
    punkter: ALLE_MODULER.filter(
      (n) => MENY[n]?.gruppe === gruppe && modulErAktivert(lagret, n),
    ).map((n) => ({ nokkel: n, ...MENY[n]! })),
  })).filter((g) => g.punkter.length > 0);
}

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
