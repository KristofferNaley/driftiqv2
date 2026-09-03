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
  "okonomi",
] as const;

export type ModulNokkel = (typeof ALLE_MODULER)[number];

/**
 * Moduler som IKKE skal dukke opp automatisk hos eksisterende kunder — de uten en egen
 * lagret modulliste. Tilsvarer `defaultOff: true` i v1s register.
 *
 * `okonomi` står med vilje IKKE her: den er grunnpakke (avklart 03.09.2026, se
 * docs/fiken.md «Posisjonering») og skal være på for alle som ikke har valgt den bort.
 * Kunder med en eksplisitt lagret modulliste får den ikke automatisk — de må få den lagt
 * til i plattformpanelet.
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
 * Modulene som prises og selges hver for seg — grunnpakken dekker resten.
 *
 * Utledet av `AV_SOM_STANDARD` fordi de to i dag er samme sett, men navnet er ikke det
 * samme spørsmålet: «av som standard» handler om hva en eksisterende kunde får uten å be om
 * det, «tilleggsmodul» om hva som står på fakturaen. Skulle en modul bli standard uten å bli
 * gratis, er det HER lista må skilles ut.
 */
export const TILLEGGSMODULER: readonly ModulNokkel[] = ALLE_MODULER.filter((k) =>
  AV_SOM_STANDARD.has(k),
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

/**
 * Menypunktet for hver modul. **Gruppene er ordrett v1s `NAV`** — se Sidebar.jsx der.
 *
 * Jeg fant først på en annen inndeling med syv grupper. Det var unødvendig endring: en
 * omskriving skal flytte koden, ikke flytte på ting styret allerede vet hvor er. Fire
 * grupper, samme navn, samme rekkefølge.
 *
 * `ikon` er navnet på et lucide-ikon; komponenten slår det opp. En streng her framfor en
 * importert komponent holder fila fri for React, så rutelaget på serversiden kan importere
 * den uten å dra inn et komponentbibliotek.
 */
export const MENY: Readonly<Partial<Record<ModulNokkel, Menypunkt>>> = {
  dashboard: { sti: "/dashboard", etikett: "Dashboard", gruppe: "Daglig drift", ikon: "LayoutDashboard" },
  tasks: { sti: "/oppgaver", etikett: "Oppgaver", gruppe: "Daglig drift", ikon: "ClipboardCheck" },
  avvik: { sti: "/avvik", etikett: "Avvik", gruppe: "Daglig drift", ikon: "TriangleAlert" },
  driftslogg: { sti: "/driftslogg", etikett: "Driftslogg", gruppe: "Daglig drift", ikon: "NotebookPen" },
  ai_radgiver: { sti: "/ai-radgiver", etikett: "AI-rådgiver", gruppe: "Daglig drift", ikon: "Sparkles" },

  arshjul: { sti: "/arshjul", etikett: "Årshjul", gruppe: "Planlegging og HMS", ikon: "CalendarDays" },
  vedlikehold: { sti: "/vedlikehold", etikett: "Vedlikehold", gruppe: "Planlegging og HMS", ikon: "Wrench" },
  internkontroll: { sti: "/internkontroll", etikett: "Internkontroll", gruppe: "Planlegging og HMS", ikon: "ShieldCheck" },
  rutiner: { sti: "/rutiner", etikett: "Rutiner", gruppe: "Planlegging og HMS", ikon: "ListChecks" },

  kontrakter: { sti: "/kontrakter", etikett: "Kontrakter", gruppe: "Arkiv og avtaler", ikon: "FileText" },
  dokumentarkiv: { sti: "/dokumentarkiv", etikett: "Dokumentarkiv", gruppe: "Arkiv og avtaler", ikon: "FolderOpen" },
  parkering: { sti: "/parkering", etikett: "Parkering", gruppe: "Arkiv og avtaler", ikon: "SquareParking" },

  okonomi: { sti: "/okonomi", etikett: "Økonomi", gruppe: "Administrasjon", ikon: "Coins" },
  leverandorer: { sti: "/leverandorer", etikett: "Leverandører", gruppe: "Administrasjon", ikon: "Truck" },
  brukere: { sti: "/brukere", etikett: "Brukere", gruppe: "Administrasjon", ikon: "Users" },
};

/**
 * Punkter som ikke er moduler og derfor aldri gates. Innstillinger kan ikke slås av — der
 * ligger blant annet enhetsregisteret og modulvalget selv.
 */
export const FASTE_PUNKTER: ReadonlyArray<Menypunkt> = [
  { sti: "/innstillinger", etikett: "Innstillinger", gruppe: "Administrasjon", ikon: "Settings" },
];

/** Rekkefølgen gruppene vises i. */
export const GRUPPER = [
  "Daglig drift",
  "Planlegging og HMS",
  "Arkiv og avtaler",
  "Administrasjon",
] as const;

/**
 * Menypunktene kunden skal se, gruppert. Låste moduler faller ut.
 *
 * `lagret === undefined` betyr «vet ikke ennå» — økten er ikke hentet. Da returneres INGEN
 * punkter, i stedet for standardsettet. Ellers tegnes feil meny i et halvsekund og bytter
 * når svaret kommer; det var nettopp blaffingen v1 hadde.
 */
export function menyFor(lagret: string | null | undefined, kjent = true) {
  if (!kjent) return [];
  // Rekkefølgen INNE i gruppen følger `MENY`, ikke `ALLE_MODULER`. De to listene har ulik
  // orden — registeret er sortert etter når modulene kom til, menyen etter hvordan styret
  // leser den. Itererte man registeret, havnet Internkontroll foran Årshjul.
  const iRekkefolge = Object.keys(MENY) as ModulNokkel[];
  return GRUPPER.map((gruppe) => ({
    gruppe,
    punkter: [
      ...iRekkefolge
        .filter((n) => MENY[n]?.gruppe === gruppe && modulErAktivert(lagret, n))
        .map((n) => ({ nokkel: n as string, ...MENY[n]! })),
      ...FASTE_PUNKTER.filter((p) => p.gruppe === gruppe).map((p) => ({ nokkel: p.sti, ...p })),
    ],
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
