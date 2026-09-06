/**
 * Ladeprising — ren utregning, importfri (jf. `nivaer.ts`-mønsteret), så både rapporten
 * på serveren og prisplanskjemaet i klienten bruker samme regler. Designnotatet er
 * `docs/easee.md` («Prisplan og rapport»).
 *
 * En strømregning for lading har tre deler, og sameiet kan ha ulike avtaler på hver:
 *
 * 1. **Kraft** — enten «norgespris» (fast øre/kWh, statlig ordning) eller **spotpris**
 *    time for time (Nord Pool for prisområdet, uten mva i kilden) pluss leverandørens
 *    påslag. Spotprisen påføres mva her; påslaget oppgis inkl. mva.
 * 2. **Nettleie, energiledd** — øre/kWh med dag- og nattsats. Natt er typisk 22–06 og
 *    hele helgen; begge deler er innstillinger i planen.
 * 3. **Fastledd** — et månedsbeløp per plass med lader, til å dekke kapasitetsledd,
 *    anleggets drift eller avskrivning. Kan være 0.
 *
 * Alle beløp er ØRE inkl. mva (jf. økonomimodulen); kWh er desimaltall. Timene
 * tidfestes i Europe/Oslo — sameiet bor der, og nettleiens natt er norsk natt.
 */

export const KRAFTMODELLER = ["norgespris", "spot"] as const;
export type Kraftmodell = (typeof KRAFTMODELLER)[number];
export const KRAFTMODELL_ETIKETT: Record<Kraftmodell, string> = {
  norgespris: "Norgespris (fast pris per kWh)",
  spot: "Spotpris time for time + påslag",
};

export const PRISOMRADER = ["NO1", "NO2", "NO3", "NO4", "NO5"] as const;
export type Prisomrade = (typeof PRISOMRADER)[number];
export const PRISOMRADE_ETIKETT: Record<Prisomrade, string> = {
  NO1: "NO1 – Østlandet (Oslo)",
  NO2: "NO2 – Sørlandet (Kristiansand)",
  NO3: "NO3 – Midt-Norge (Trondheim)",
  NO4: "NO4 – Nord-Norge (Tromsø)",
  NO5: "NO5 – Vestlandet (Bergen)",
};

/** Det rapporten trenger av en plan — samme felter som `easee_price_plans`. */
export type Prisplan = {
  kraftModel: Kraftmodell;
  /** Norgespris: øre/kWh inkl. mva. */
  kraftOre: number;
  /** Spot: påslag øre/kWh inkl. mva. */
  paaslagOre: number;
  priceArea: Prisomrade | null;
  /** Mva på spotprisen, prosent (25 — 0 i Nord-Norge). */
  mvaProsent: number;
  nettDagOre: number;
  nettNattOre: number;
  /** Natt fra og med denne timen (22) … */
  nattFra: number;
  /** … til (ikke med) denne timen (6). */
  nattTil: number;
  helgSomNatt: boolean;
  /** Øre per måned per plass med lader. */
  fastleddOre: number;
};

/** Time og ukedag i Europe/Oslo for et tidspunkt. */
export function osloTime(t: Date): { time: number; ukedag: number } {
  const deler = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Oslo", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(t);
  const time = Number(deler.find((d) => d.type === "hour")?.value ?? 0) % 24;
  const ukedag = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(deler.find((d) => d.type === "weekday")?.value ?? "Mon");
  return { time, ukedag: ukedag < 0 ? 1 : ukedag };
}

/** Nattsats? Helg (lør/søn) teller som natt når planen sier det. */
export function erNatt(t: Date, plan: Pick<Prisplan, "nattFra" | "nattTil" | "helgSomNatt">): boolean {
  const { time, ukedag } = osloTime(t);
  if (plan.helgSomNatt && (ukedag === 0 || ukedag === 6)) return true;
  // Natt kan gå over midnatt (22–06) eller ikke (0–6).
  return plan.nattFra > plan.nattTil ? time >= plan.nattFra || time < plan.nattTil : time >= plan.nattFra && time < plan.nattTil;
}

/** Spotpris i kilden (NOK/kWh uten mva) → øre/kWh inkl. mva, rundet til heltall. */
export function spotTilOre(nokPerKwh: number, mvaProsent: number): number {
  return Math.round(nokPerKwh * 100 * (1 + mvaProsent / 100));
}

/**
 * Prisen for én time. Spotplan uten spotpris for timen gir `kraftOre: null` — rapporten
 * teller slike timer og sier fra, i stedet for å stille bruke 0.
 */
export function prisForTime(plan: Prisplan, t: Date, spotNokPerKwh: number | null): { kraftOre: number | null; nettOre: number; natt: boolean } {
  const natt = erNatt(t, plan);
  const nettOre = natt ? plan.nettNattOre : plan.nettDagOre;
  if (plan.kraftModel === "norgespris") return { kraftOre: plan.kraftOre, nettOre, natt };
  if (spotNokPerKwh === null) return { kraftOre: null, nettOre, natt };
  return { kraftOre: spotTilOre(spotNokPerKwh, plan.mvaProsent) + plan.paaslagOre, nettOre, natt };
}

export type Timeforbruk = { start: Date; kwh: number };

export type Kostnad = {
  kwhDag: number;
  kwhNatt: number;
  /** Øre. */
  kraftOre: number;
  nettOre: number;
  /** Timer med forbruk der spotpris manglet — kraften for dem er IKKE med i `kraftOre`. */
  timerUtenPris: number;
  kwhUtenPris: number;
};

/** Summerer et sett timer etter planen. Kroner regnes per time og rundes til slutt. */
export function beregnKostnad(plan: Prisplan, timer: ReadonlyArray<Timeforbruk>, spot: ReadonlyMap<number, number> = new Map()): Kostnad {
  let kwhDag = 0, kwhNatt = 0, kraft = 0, nett = 0, timerUtenPris = 0, kwhUtenPris = 0;
  for (const t of timer) {
    if (!(t.kwh > 0)) continue;
    const p = prisForTime(plan, t.start, spot.get(t.start.getTime()) ?? null);
    if (p.natt) kwhNatt += t.kwh; else kwhDag += t.kwh;
    nett += t.kwh * p.nettOre;
    if (p.kraftOre === null) { timerUtenPris++; kwhUtenPris += t.kwh; }
    else kraft += t.kwh * p.kraftOre;
  }
  return { kwhDag, kwhNatt, kraftOre: Math.round(kraft), nettOre: Math.round(nett), timerUtenPris, kwhUtenPris };
}

/** Planen som gjelder for en måned: den nyeste med `validFrom` ≤ første dag i måneden. */
export function gjeldendePlan<T extends { validFrom: string }>(planer: ReadonlyArray<T>, aar: number, maaned: number): T | null {
  const dato = `${aar}-${String(maaned).padStart(2, "0")}-01`;
  return [...planer].filter((p) => p.validFrom <= dato).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0] ?? null;
}

/** Første time i måneden og første time i neste, som UTC-tidspunkter for Oslo-måneden. */
export function maanedsgrenser(aar: number, maaned: number): { fra: Date; til: Date } {
  // Første dag i måneden kl. 00 Oslo: finn UTC-offset ved å prøve midnatt UTC og justere.
  const osloMidnatt = (y: number, m: number) => {
    const gjett = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    const deler = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Oslo", hour: "numeric", hour12: false }).formatToParts(gjett);
    const osloTime = Number(deler.find((d) => d.type === "hour")?.value ?? 0) % 24;
    // Midnatt UTC er kl. 01 eller 02 i Oslo → Oslo-midnatt var én/to timer tidligere.
    return new Date(gjett.getTime() - osloTime * 3600 * 1000);
  };
  const neste = maaned === 12 ? { y: aar + 1, m: 1 } : { y: aar, m: maaned + 1 };
  return { fra: osloMidnatt(aar, maaned), til: osloMidnatt(neste.y, neste.m) };
}
