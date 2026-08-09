/**
 * Frekvenser og forsinket-regelen. **Dette er det ENESTE stedet regelen finnes.**
 *
 * I v1 lå den i sju kopier — én i `notifications.py` (som sendte e-posten) og seks i
 * frontend — og de hadde drevet fra hverandre: leverandørportalen og QR-skjemaet regnet
 * halvårlig som 182 dager, resten som 183. E-posten varslet altså om noe annet enn skjermen
 * viste. Regelen ble samlet i `taskConstants.js` 08.08.2026 og speilet av backend, men to
 * kopier i to språk må fortsatt holdes i synk for hånd.
 *
 * Her er det én fil. Server og klient importerer den samme funksjonen, så de KAN ikke
 * divergere. Det er den mest konkrete gevinsten ved å ha ett språk i hele stacken.
 *
 * Legger du til en frekvens: verdien må inn i `frequencyEnum` (Postgres-enum, krever
 * `ALTER TYPE`) OG i `FREQ_DAGER` under. Mangler dagtallet, blir oppgaven stille aldri
 * forsinket — `if (!dager) return false`.
 */

export const FREQ_DAGER: Readonly<Record<string, number>> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  semiannual: 183,
  annual: 365,
  every_3_years: 1095,
  every_5_years: 1826,
  every_8_years: 2922,
  // `on_demand` har med vilje ingen verdi: uten frist kan den aldri bli forsinket.
};

export const FREQ_ETIKETTER: Readonly<Record<string, string>> = {
  weekly: "Ukentlig",
  biweekly: "Hver 14. dag",
  monthly: "Månedlig",
  quarterly: "Kvartalsvis",
  semiannual: "Halvårlig",
  annual: "Årlig",
  every_3_years: "Hvert 3. år",
  every_5_years: "Hvert 5. år",
  every_8_years: "Hvert 8. år",
  on_demand: "Ved behov",
};

/** Det regelen trenger å vite om en oppgave. Bevisst minimal, så både rader fra basen og
 *  DTO-er fra API-et passer uten oversettelse. */
export type ForsinkelseInput = {
  active?: boolean | null;
  frequency: string;
  startDate?: string | null;
  dueDate?: string | null;
  /** Dato for siste utkvittering, `YYYY-MM-DD`. Null = aldri utført. */
  lastCompletedAt?: string | null;
};

const iDag = () => new Date().toISOString().slice(0, 10);

function leggTilDager(dato: string, dager: number): string {
  const d = new Date(`${dato}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dager);
  return d.toISOString().slice(0, 10);
}

/**
 * Når oppgaven skal utføres neste gang, eller null når den ikke har en syklus.
 *
 * Fristen på første utførelse (`dueDate`) vinner over `startDate` fram til oppgaven er
 * kvittert ut én gang: en frist er strengere enn en planlagt start.
 */
export function nesteFrist(t: ForsinkelseInput): string | null {
  if (t.lastCompletedAt) {
    const dager = FREQ_DAGER[t.frequency];
    return dager ? leggTilDager(t.lastCompletedAt, dager) : null;
  }
  if (t.dueDate) return t.dueDate;
  if (t.startDate) return t.startDate;
  return null;
}

/**
 * Om oppgaven skulle vært utført.
 *
 * Rekkefølgen betyr noe: `dueDate` sjekkes FØR frekvensen, og gjelder bare til oppgaven er
 * kvittert ut første gang. Det er dét som gjør at en `on_demand`-oppgave med frist kan bli
 * forsinket — uten fristen har den ingen syklus og kunne aldri bli det.
 */
export function erForsinket(t: ForsinkelseInput): boolean {
  if (t.active === false) return false;
  const today = iDag();

  // Frist på en oppgave som aldri er utført — uavhengig av frekvens.
  if (t.dueDate && !t.lastCompletedAt) return t.dueDate < today;

  if (t.frequency === "on_demand") return false;

  const dager = FREQ_DAGER[t.frequency];
  if (!dager) return false;

  if (t.lastCompletedAt) return leggTilDager(t.lastCompletedAt, dager) < today;
  if (t.startDate) return t.startDate < today;

  // Ingen utkvittering, ingen startdato, men en reell frekvens: den skulle vært i gang.
  return true;
}
