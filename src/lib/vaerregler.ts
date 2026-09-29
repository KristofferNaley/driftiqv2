/**
 * Vær- og avgangsregler for oppslagstavla. IMPORTFRI — leses av skjermen (klient) og av
 * tolkningen på serveren. Designnotatet er `docs/entur-yr.md`.
 */

/**
 * METs `symbol_code` (f.eks. `lightrainshowers_day`) → lucide-ikon (som streng, så fila
 * er React-fri) og norsk tekst. Døgnvarianten (`_day`/`_night`/`_polartwilight`) skrelles
 * av først; natt får månen der det finnes et månesymbol.
 *
 * Rekkefølgen betyr noe: første treff vinner, så «sleet» må stå før «rain», og «thunder»
 * før alt annet.
 */
const SYMBOLER: ReadonlyArray<{ inneholder: string; ikon: string; natt?: string; tekst: string }> = [
  { inneholder: "thunder", ikon: "CloudLightning", tekst: "Torden" },
  { inneholder: "sleet", ikon: "CloudHail", tekst: "Sludd" },
  { inneholder: "snow", ikon: "CloudSnow", tekst: "Snø" },
  { inneholder: "heavyrain", ikon: "CloudRainWind", tekst: "Kraftig regn" },
  { inneholder: "lightrain", ikon: "CloudDrizzle", tekst: "Lett regn" },
  { inneholder: "rainshowers", ikon: "CloudSunRain", natt: "CloudMoonRain", tekst: "Regnbyger" },
  { inneholder: "rain", ikon: "CloudRain", tekst: "Regn" },
  { inneholder: "fog", ikon: "CloudFog", tekst: "Tåke" },
  { inneholder: "partlycloudy", ikon: "CloudSun", natt: "CloudMoon", tekst: "Delvis skyet" },
  { inneholder: "fair", ikon: "CloudSun", natt: "CloudMoon", tekst: "Lettskyet" },
  { inneholder: "clearsky", ikon: "Sun", natt: "Moon", tekst: "Klarvær" },
  { inneholder: "cloudy", ikon: "Cloud", tekst: "Skyet" },
];

export function vaersymbol(kode: string | null | undefined): { ikon: string; tekst: string } {
  if (!kode) return { ikon: "Cloud", tekst: "" };
  const natt = kode.endsWith("_night") || kode.endsWith("_polartwilight");
  const s = SYMBOLER.find((x) => kode.includes(x.inneholder));
  if (!s) return { ikon: "Cloud", tekst: "" };
  return { ikon: natt && s.natt ? s.natt : s.ikon, tekst: s.tekst };
}

export const VAERVISNINGER = ["timer", "dager"] as const;
export type Vaervisning = (typeof VAERVISNINGER)[number];
export const VAERVISNING_ETIKETT: Record<Vaervisning, string> = {
  timer: "De neste timene",
  dager: "De neste dagene",
};

/** Entur `transportMode` → lucide-ikon og tekst. Ukjent modus får bussen. */
export const TRANSPORTMIDDEL: Readonly<Record<string, { ikon: string; tekst: string }>> = {
  bus: { ikon: "Bus", tekst: "Buss" },
  coach: { ikon: "Bus", tekst: "Buss" },
  tram: { ikon: "TramFront", tekst: "Bybane" },
  metro: { ikon: "TrainFront", tekst: "T-bane" },
  rail: { ikon: "TrainFront", tekst: "Tog" },
  water: { ikon: "Ship", tekst: "Båt" },
  air: { ikon: "Plane", tekst: "Fly" },
};
export const transportmiddel = (modus: string) => TRANSPORTMIDDEL[modus] ?? TRANSPORTMIDDEL.bus!;

/** Maks antall holdeplasser per borettslag, og avganger per holdeplass på skjermen. */
export const MAKS_HOLDEPLASSER = 2;
export const AVGANGER_PER_HOLDEPLASS = 6;

/**
 * «nå», «4 min», ellers klokkeslett — slik skiltene på holdeplassen gjør det. Over en
 * kvarter er minuttene mindre nyttige enn tiden.
 */
export function avgangstid(iso: string, naa: Date): string {
  const min = Math.floor((new Date(iso).getTime() - naa.getTime()) / 60_000);
  if (min <= 0) return "nå";
  if (min < 15) return `${min} min`;
  return new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" });
}
