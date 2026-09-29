/**
 * Værmelding fra MET Norway (api.met.no, samme data som yr.no) — HTTP, tolkning og
 * mellomlager. Ingen databasetilgang; det ligger i `vaerkobling.ts`. Designnotatet er
 * `docs/entur-yr.md`.
 *
 * ## Vilkårene til MET, som koden følger
 *
 * - Identifiserende `User-Agent` med nettsted — uten den svarer MET 403.
 * - Hurtigbuffer: gjenbruk svaret til `Expires`, og spør deretter med `If-Modified-Since`
 *   (304 = uendret). Ti skjermer på samme sted gir ett kall, ikke ti per minutt.
 * - Koordinater med høyst fire desimaler (gjøres ved lagring, `rundAv`).
 * - Kreditering: «Værdata fra MET Norway» står under varselet på skjermen (CC BY 4.0).
 */

import { osloIDag, type Varsel } from "./oppslagstavleregler";

export const MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
export const MET_USER_AGENT = "DriftIQ-oppslagstavle/1.0 (+https://driftiq.no)";

export class YrFeil extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = "YrFeil";
  }
}

export const rundAv = (x: number) => Math.round(x * 10_000) / 10_000;

type Tidssteg = {
  time: string;
  data: {
    instant: { details: { air_temperature?: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
  };
};

export type { Varsel };

const osloTime = (iso: string) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", hour: "2-digit", hour12: false }).format(new Date(iso)));

/**
 * METs tidsserie → det tavla viser. `naa` er injisert for testbarhet.
 *
 * - **Nå**: siste tidssteg som ikke er i framtiden (serien starter på inneværende time).
 * - **Timer**: de neste tolv hele timene med ettimessymbol og nedbør.
 * - **Dager**: fra i morgen, fem dager. Maks/min av temperaturene den (Oslo-)dagen, symbolet
 *   rundt midt på dagen, og nedbøren som summen av seks-timers-blokkene som starter den dagen.
 */
export function tolkVarsel(raa: unknown, naa: Date = new Date()): Varsel {
  const serie = (raa as { properties?: { timeseries?: Tidssteg[] } })?.properties?.timeseries;
  if (!Array.isArray(serie) || serie.length === 0) throw new YrFeil("Uventet svar fra MET");
  const temp = (s: Tidssteg) => s.data.instant.details.air_temperature ?? 0;

  const forbi = serie.filter((s) => new Date(s.time).getTime() <= naa.getTime());
  const gjeldende = forbi[forbi.length - 1] ?? serie[0]!;
  const nesteTimer = serie.filter((s) => new Date(s.time).getTime() > naa.getTime() && s.data.next_1_hours).slice(0, 12);

  const iDag = osloIDag(naa);
  const perDag = new Map<string, Tidssteg[]>();
  for (const s of serie) {
    const d = osloIDag(new Date(s.time));
    if (d <= iDag) continue;
    perDag.set(d, [...(perDag.get(d) ?? []), s]);
  }
  const dager = [...perDag.entries()].slice(0, 5).map(([dato, steg]) => {
    const temper = steg.map(temp);
    const midt = [...steg].sort((a, b) => Math.abs(osloTime(a.time) - 13) - Math.abs(osloTime(b.time) - 13))[0]!;
    const nedbor = steg
      .filter((s) => new Date(s.time).getUTCHours() % 6 === 0)
      .reduce((n, s) => n + (s.data.next_6_hours?.details?.precipitation_amount ?? 0), 0);
    return {
      dato,
      maks: Math.max(...temper),
      min: Math.min(...temper),
      symbol: midt.data.next_6_hours?.summary?.symbol_code ?? midt.data.next_1_hours?.summary?.symbol_code ?? null,
      nedbor: Math.round(nedbor * 10) / 10,
    };
  });

  return {
    naa: {
      temp: temp(gjeldende),
      symbol:
        gjeldende.data.next_1_hours?.summary?.symbol_code ?? gjeldende.data.next_6_hours?.summary?.symbol_code ?? null,
    },
    timer: nesteTimer.map((s) => ({
      tid: s.time,
      temp: temp(s),
      symbol: s.data.next_1_hours?.summary?.symbol_code ?? null,
      nedbor: s.data.next_1_hours?.details?.precipitation_amount ?? null,
    })),
    dager,
  };
}

const FORELDET_MS = 6 * 3_600_000;
const lager = new Map<string, { utloper: number; endret: string | null; hentet: number; raa: unknown }>();

/** Tømmes av testene. */
export function tomYrLager() {
  lager.clear();
}

/**
 * Varselet for et sted, fra minnet til MET sier det er utløpt. Kaster aldri: ved feil brukes
 * siste svar i inntil seks timer, ellers `null` (og feltet vises uten varsel).
 */
export async function varselFor(lat: number, lon: number, naa: Date = new Date()): Promise<Varsel | null> {
  const nokkel = `${rundAv(lat)},${rundAv(lon)}`;
  const i = lager.get(nokkel);
  if (i && naa.getTime() < i.utloper) return tolkVarsel(i.raa, naa);

  try {
    const url = `${MET_URL}?${new URLSearchParams({ lat: String(rundAv(lat)), lon: String(rundAv(lon)) })}`;
    let svar: Response;
    try {
      svar = await fetch(url, {
        headers: {
          "User-Agent": MET_USER_AGENT,
          Accept: "application/json",
          ...(i?.endret ? { "If-Modified-Since": i.endret } : {}),
        },
        signal: AbortSignal.timeout(6_000),
      });
    } catch {
      throw new YrFeil("Fikk ikke kontakt med MET");
    }
    const utloper = Date.parse(svar.headers.get("expires") ?? "") || naa.getTime() + 30 * 60_000;
    if (svar.status === 304 && i) {
      lager.set(nokkel, { ...i, utloper });
      return tolkVarsel(i.raa, naa);
    }
    if (!svar.ok) throw new YrFeil(`MET svarte ${svar.status}`);
    const raa = await svar.json();
    const varsel = tolkVarsel(raa, naa);
    lager.set(nokkel, { utloper, endret: svar.headers.get("last-modified"), hentet: naa.getTime(), raa });
    return varsel;
  } catch (e) {
    if (!(e instanceof YrFeil)) console.error("[yr] Uventet feil:", e);
    return i && naa.getTime() - i.hentet < FORELDET_MS ? tolkVarsel(i.raa, naa) : null;
  }
}
