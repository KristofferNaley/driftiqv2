/**
 * Entur-adapteret — HTTP, tolkning og mellomlager. Ingen databasetilgang; det ligger i
 * `enturkobling.ts`. Designnotatet er `docs/entur-yr.md`.
 *
 * Åpne API-er (NLOD), uten nøkkel, men Entur krever at klienten navngir seg i
 * `ET-Client-Name` — ellers kan de strupe oss uten å vite hvem de skal kontakte.
 *
 * ## Mellomlageret
 *
 * Hver skjerm henter innhold hvert minutt. Ti skjermer på samme holdeplass skal ikke bli ti
 * kall mot Entur: avgangene holdes i minnet i `AVGANG_TTL_MS` per holdeplass. Feiler Entur,
 * brukes forrige svar i inntil `FORELDET_MS` (avganger som har gått, filtreres bort ved
 * visning) — deretter tom liste. Minnet deles mellom alle orger; det er offentlige
 * rutedata, ikke kundedata.
 */

export const ENTUR_KLIENTNAVN = "driftiq-oppslagstavle";

export const TILLATTE_KALL: ReadonlyArray<{ url: string; hva: string }> = [
  { url: "https://api.entur.io/geocoder/v1/autocomplete", hva: "søk etter holdeplass" },
  { url: "https://api.entur.io/journey-planner/v3/graphql", hva: "neste avganger fra én holdeplass" },
];

export class EnturFeil extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = "EnturFeil";
  }
}

async function kall(url: string, init: RequestInit = {}): Promise<unknown> {
  const base = url.split("?")[0];
  if (!TILLATTE_KALL.some((k) => k.url === base)) throw new Error(`Entur-kall utenfor hvitelista: ${base}`);
  let svar: Response;
  try {
    svar = await fetch(url, {
      ...init,
      headers: { "ET-Client-Name": ENTUR_KLIENTNAVN, Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new EnturFeil("Fikk ikke kontakt med Entur");
  }
  if (!svar.ok) throw new EnturFeil(`Entur svarte ${svar.status}`);
  return svar.json();
}

export const erHoldeplassId = (id: string) => /^NSR:StopPlace:\d+$/.test(id);

export type Holdeplasstreff = { id: string; navn: string; sted: string | null; moduser: string[] };

/** Geocoderens GeoJSON → holdeplasser. Eksportert for testene. */
export function tolkHoldeplasser(raa: unknown): Holdeplasstreff[] {
  const features = (raa as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) throw new EnturFeil("Uventet svar fra Enturs søk");
  const ut: Holdeplasstreff[] = [];
  for (const f of features) {
    const p = (f as { properties?: Record<string, unknown> }).properties ?? {};
    const id = typeof p.id === "string" ? p.id : "";
    if (!erHoldeplassId(id)) continue;
    const moduser = Array.isArray(p.mode)
      ? p.mode.flatMap((m) => (typeof m === "object" && m !== null ? Object.keys(m) : []))
      : [];
    ut.push({
      id,
      navn: String(p.name ?? id),
      sted: typeof p.locality === "string" ? p.locality : null,
      moduser: [...new Set(moduser)],
    });
  }
  return ut;
}

export async function sokHoldeplass(q: string): Promise<Holdeplasstreff[]> {
  const url =
    `${TILLATTE_KALL[0]!.url}?` + new URLSearchParams({ text: q, layers: "venue", size: "8", lang: "no" }).toString();
  return tolkHoldeplasser(await kall(url));
}

export type Avgang = {
  linje: string;
  modus: string;
  mot: string;
  tid: string;
  sanntid: boolean;
  innstilt: boolean;
};

const SPORRING = `query ($id: String!, $n: Int!) {
  stopPlace(id: $id) {
    name
    estimatedCalls(numberOfDepartures: $n, timeRange: 7200) {
      expectedDepartureTime
      realtime
      cancellation
      destinationDisplay { frontText }
      serviceJourney { line { publicCode transportMode } }
    }
  }
}`;

/** GraphQL-svaret → avganger. Eksportert for testene. */
export function tolkAvganger(raa: unknown): Avgang[] {
  const d = raa as {
    errors?: Array<{ message?: string }>;
    data?: { stopPlace?: { estimatedCalls?: Array<Record<string, unknown>> } | null };
  };
  if (d?.errors?.length) throw new EnturFeil(d.errors[0]?.message ?? "Feil fra Entur");
  const kallene = d?.data?.stopPlace?.estimatedCalls;
  if (!Array.isArray(kallene)) throw new EnturFeil("Fant ikke holdeplassen hos Entur");
  return kallene.flatMap((c) => {
    const linje = (c.serviceJourney as { line?: { publicCode?: string; transportMode?: string } } | undefined)?.line;
    const tid = c.expectedDepartureTime;
    if (typeof tid !== "string") return [];
    return [
      {
        linje: linje?.publicCode ?? "",
        modus: linje?.transportMode ?? "bus",
        mot: (c.destinationDisplay as { frontText?: string } | undefined)?.frontText ?? "",
        tid,
        sanntid: c.realtime === true,
        innstilt: c.cancellation === true,
      },
    ];
  });
}

const AVGANG_TTL_MS = 30_000;
const FORELDET_MS = 30 * 60_000;
const lager = new Map<string, { hentet: number; avganger: Avgang[] }>();

/** Tømmes av testene. */
export function tomEnturLager() {
  lager.clear();
}

/**
 * Neste avganger, fra minnet hvis ferske nok. Kaster aldri — en tavle uten avganger er
 * bedre enn en tavle som ikke svarer. `naa` er injisert for testbarhet.
 */
export async function avgangerFra(stopId: string, antall: number, naa = Date.now()): Promise<Avgang[]> {
  const i = lager.get(stopId);
  if (i && naa - i.hentet < AVGANG_TTL_MS) return i.avganger;
  try {
    const raa = await kall(TILLATTE_KALL[1]!.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: SPORRING, variables: { id: stopId, n: antall } }),
    });
    const avganger = tolkAvganger(raa);
    lager.set(stopId, { hentet: naa, avganger });
    return avganger;
  } catch (e) {
    if (!(e instanceof EnturFeil)) console.error("[entur] Uventet feil:", e);
    return i && naa - i.hentet < FORELDET_MS ? i.avganger : [];
  }
}
