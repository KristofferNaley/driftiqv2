/**
 * Spotpriser fra hvakosterstrommen.no — åpent og gratis, ingen nøkkel. Én fil per dag og
 * prisområde: `/api/v1/prices/ÅÅÅÅ/MM-DD_NO5.json`, med NOK/kWh UTEN mva per time.
 * Morgendagens priser kommer tidligst kl. 13. Kilden ber om å bli nevnt — det gjør
 * rapporten i fotnoten.
 *
 * Importfri utover `fetch`. Databasen (`power_prices`) håndteres i `easeekobling.ts`.
 */

export const SPOTPRIS_API = "https://www.hvakosterstrommen.no/api/v1/prices";

export class SpotprisFeil extends Error {
  constructor(
    readonly status: number,
    melding: string,
  ) {
    super(melding);
    this.name = "SpotprisFeil";
  }
}

export type Spottime = { hourStart: Date; nokPerKwh: number };

/** ÅÅÅÅ-MM-DD i Oslo-tid for et tidspunkt. */
export function osloDato(t: Date): string {
  const d = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  return d;
}

export function spotprisUrl(dato: string, area: string): string {
  const [aar, md] = [dato.slice(0, 4), dato.slice(5, 10)];
  return `${SPOTPRIS_API}/${aar}/${md}_${area}.json`;
}

/**
 * Prisene for én dag og ett område. 404 = ikke publisert ennå (morgendagen før kl. 13)
 * — returneres som tom liste, ikke feil. Kvartersoppløsning (fra 2025) summeres til timer
 * ved å ta gjennomsnittet av periodene som starter i samme time.
 */
export async function hentSpotpriser(dato: string, area: string): Promise<Spottime[]> {
  const svar = await fetch(spotprisUrl(dato, area), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (svar.status === 404) return [];
  if (!svar.ok) throw new SpotprisFeil(svar.status, `hvakosterstrommen.no svarte ${svar.status} for ${dato} ${area}`);
  const rader = (await svar.json()) as Array<{ NOK_per_kWh: number; time_start: string; time_end?: string }>;
  const perTime = new Map<number, { sum: number; n: number }>();
  for (const r of Array.isArray(rader) ? rader : []) {
    const start = new Date(r.time_start);
    if (Number.isNaN(start.getTime()) || typeof r.NOK_per_kWh !== "number") continue;
    const time = new Date(start);
    time.setUTCMinutes(0, 0, 0);
    const k = time.getTime();
    const e = perTime.get(k) ?? { sum: 0, n: 0 };
    e.sum += r.NOK_per_kWh;
    e.n++;
    perTime.set(k, e);
  }
  return [...perTime.entries()]
    .map(([k, e]) => ({ hourStart: new Date(k), nokPerKwh: e.sum / e.n }))
    .sort((a, b) => a.hourStart.getTime() - b.hourStart.getTime());
}
