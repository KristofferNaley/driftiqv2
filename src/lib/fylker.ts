/**
 * Fylkene etter regionreformen 2024, med fylkesnummer fra SSB. **Ingen importer** — brukes
 * av boligbyggelagregisteret i både API og nettleser.
 *
 * Region på et boligbyggelag var fritekst, og registeret fikk både «Vestland» og
 * «Vestlandet» (01.10.2026). Nå lagres fylkesnummer i `bbl.county_codes` — en LISTE, fordi
 * et boligbyggelag ofte dekker flere fylker. Navnet vises, nummeret lagres: et fylke som
 * skifter navn igjen er da én linje her, ikke en datamigrering.
 */

export const FYLKER = [
  { nr: "03", navn: "Oslo" },
  { nr: "11", navn: "Rogaland" },
  { nr: "15", navn: "Møre og Romsdal" },
  { nr: "18", navn: "Nordland" },
  { nr: "31", navn: "Østfold" },
  { nr: "32", navn: "Akershus" },
  { nr: "33", navn: "Buskerud" },
  { nr: "34", navn: "Innlandet" },
  { nr: "39", navn: "Vestfold" },
  { nr: "40", navn: "Telemark" },
  { nr: "42", navn: "Agder" },
  { nr: "46", navn: "Vestland" },
  { nr: "50", navn: "Trøndelag" },
  { nr: "55", navn: "Troms" },
  { nr: "56", navn: "Finnmark" },
] as const;

export type Fylkesnr = (typeof FYLKER)[number]["nr"];

export const FYLKESNR = FYLKER.map((f) => f.nr) as [Fylkesnr, ...Fylkesnr[]];

/** Alfabetisk etter navn — rekkefølgen i velgeren. */
export const FYLKER_ALFABETISK = [...FYLKER].sort((a, b) => a.navn.localeCompare(b.navn, "nb"));

const NAVN = new Map<string, string>(FYLKER.map((f) => [f.nr, f.navn]));

export function fylkesnavn(nr: string): string {
  return NAVN.get(nr) ?? nr;
}

/** «Vestland, Rogaland» i fast rekkefølge (alfabetisk), uansett lagringsrekkefølge. */
export function fylkesliste(nr: ReadonlyArray<string> | null | undefined): string {
  return [...(nr ?? [])]
    .map(fylkesnavn)
    .sort((a, b) => a.localeCompare(b, "nb"))
    .join(", ");
}
