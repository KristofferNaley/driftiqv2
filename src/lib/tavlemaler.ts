/**
 * Malene for oppslagstavla: hvordan skjermen deles i soner, og hva som står i dem som
 * standard. IMPORTFRI — leses av skjermen, forhåndsvisningen, innstillingene og serveren.
 * Designnotatet er `docs/oppslagstavle.md` («Maler og soner»).
 *
 * Hver mal har stort sett én STOR sone (`a`) og noen mindre, pluss en valgfri **stripe**
 * nederst som bare tar den høyden innholdet trenger (tømmedager, vær). En sone med flere
 * blokker roterer mellom dem; en tom sone får ingen boks — for et helt tomt område skal
 * styret heller velge en mal med færre soner.
 */

import type { Retning } from "./oppslagstavleregler";

/** Blokkene som ikke har egen rad i `board_blocks`. Egne blokker har nøkkelen `blokk:<id>`. */
export const INNEBYGDE_BLOKKER = ["oppslag", "kalender", "kontakt", "tommedager"] as const;
export type InnebygdBlokk = (typeof INNEBYGDE_BLOKKER)[number];
export const INNEBYGD_NAVN: Record<InnebygdBlokk, string> = {
  oppslag: "Oppslag",
  kalender: "Kalender",
  kontakt: "Kontakt styret",
  tommedager: "Tømmedager (BIR)",
};
export const blokkNokkel = (id: string) => `blokk:${id}`;

export const STRIPE = "stripe";

export type Mal = {
  id: string;
  navn: string;
  retning: Retning;
  /** Sonene i lesefølge, uten stripen (den har alle maler). */
  soner: string[];
  kolonner: string;
  rader: string;
  /** `grid-template-areas`, én streng per rad. */
  omrader: string[];
  standard: Record<string, string[]>;
};

const fr = (...x: number[]) => x.map((n) => `minmax(0,${n}fr)`).join(" ");

export const MALER: readonly Mal[] = [
  // --- Liggende -------------------------------------------------------------------------
  {
    id: "l-stor-to", navn: "Stor + to", retning: "liggende", soner: ["a", "b", "c"],
    kolonner: fr(1.6, 1), rader: fr(1.3, 1), omrader: ["a b", "a c"],
    standard: { a: ["oppslag"], b: ["kalender"], c: ["kontakt"], stripe: ["tommedager"] },
  },
  {
    id: "l-stor-tre", navn: "Stor + tre", retning: "liggende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1.6, 1), rader: fr(1, 1, 1), omrader: ["a b", "a c", "a d"],
    standard: { a: ["oppslag"], b: ["kalender"], c: ["tommedager"], d: ["kontakt"], stripe: [] },
  },
  {
    id: "l-to-like", navn: "To like", retning: "liggende", soner: ["a", "b"],
    kolonner: fr(1, 1), rader: fr(1), omrader: ["a b"],
    standard: { a: ["oppslag"], b: ["kalender", "kontakt"], stripe: ["tommedager"] },
  },
  {
    id: "l-tre-kolonner", navn: "Tre kolonner", retning: "liggende", soner: ["a", "b", "c"],
    kolonner: fr(1, 1, 1), rader: fr(1), omrader: ["a b c"],
    standard: { a: ["oppslag"], b: ["kalender"], c: ["kontakt"], stripe: ["tommedager"] },
  },
  {
    id: "l-rutenett", navn: "Rutenett 2 × 2", retning: "liggende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1, 1), rader: fr(1, 1), omrader: ["a b", "c d"],
    standard: { a: ["oppslag"], b: ["kalender"], c: ["tommedager"], d: ["kontakt"], stripe: [] },
  },
  {
    id: "l-fullskjerm", navn: "Fullskjerm", retning: "liggende", soner: ["a"],
    kolonner: fr(1), rader: fr(1), omrader: ["a"],
    standard: { a: ["oppslag"], stripe: ["tommedager"] },
  },
  // --- Stående --------------------------------------------------------------------------
  {
    id: "s-stor-to", navn: "Stor + to", retning: "staende", soner: ["a", "b", "c"],
    kolonner: fr(1), rader: fr(1.5, 1, 0.7), omrader: ["a", "b", "c"],
    standard: { a: ["oppslag"], b: ["kalender"], c: ["kontakt"], stripe: ["tommedager"] },
  },
  {
    id: "s-stor-tre", navn: "Stor + tre", retning: "staende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1), rader: fr(1.5, 1, 1, 0.7), omrader: ["a", "b", "c", "d"],
    standard: { a: ["oppslag"], b: ["kalender"], c: ["tommedager"], d: ["kontakt"], stripe: [] },
  },
  {
    id: "s-stor-side", navn: "Stor + to side om side", retning: "staende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1, 1), rader: fr(1.5, 1, 0.7), omrader: ["a a", "b c", "d d"],
    standard: { a: ["oppslag"], b: ["kalender"], c: ["tommedager"], d: ["kontakt"], stripe: [] },
  },
  {
    id: "s-to-like", navn: "To like", retning: "staende", soner: ["a", "b"],
    kolonner: fr(1), rader: fr(1, 1), omrader: ["a", "b"],
    standard: { a: ["oppslag"], b: ["kalender", "kontakt"], stripe: ["tommedager"] },
  },
  {
    id: "s-fullskjerm", navn: "Fullskjerm", retning: "staende", soner: ["a"],
    kolonner: fr(1), rader: fr(1), omrader: ["a"],
    standard: { a: ["oppslag"], stripe: ["tommedager"] },
  },
];

export const STANDARD_MAL: Record<Retning, string> = { liggende: "l-stor-to", staende: "s-stor-to" };

export const SONE_NAVN: Record<string, string> = {
  a: "Stort felt",
  b: "Felt B",
  c: "Felt C",
  d: "Felt D",
  stripe: "Stripe nederst",
};

export const malerFor = (retning: Retning) => MALER.filter((m) => m.retning === retning);

/** Malen skjermen skal bruke. Ukjent, eller en mal for den andre retningen ⇒ standardmalen. */
export function finnMal(id: string | null | undefined, retning: Retning): Mal {
  const m = MALER.find((x) => x.id === id && x.retning === retning);
  return m ?? MALER.find((x) => x.id === STANDARD_MAL[retning])!;
}

/**
 * Tolker `board_screens.zones` for en mal. Soner malen ikke har, faller bort; nøkler som
 * ikke er blant `gyldige` (en slettet blokk), faller bort. `null`/ugyldig JSON ⇒ malens
 * standard. Hver sone og stripen er alltid med i svaret, eventuelt tom.
 */
export function lesSoner(lagret: string | null | undefined, mal: Mal, gyldige: ReadonlySet<string>): Record<string, string[]> {
  let raa: unknown;
  try {
    raa = lagret ? JSON.parse(lagret) : null;
  } catch {
    raa = null;
  }
  const kilde =
    raa && typeof raa === "object" && !Array.isArray(raa) ? (raa as Record<string, unknown>) : mal.standard;
  const ut: Record<string, string[]> = {};
  for (const sone of [...mal.soner, STRIPE]) {
    const liste = Array.isArray(kilde[sone]) ? (kilde[sone] as unknown[]) : [];
    ut[sone] = [...new Set(liste.filter((n): n is string => typeof n === "string" && gyldige.has(n)))];
  }
  return ut;
}
