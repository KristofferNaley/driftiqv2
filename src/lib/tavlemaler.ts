/**
 * Malene for oppslagstavla og fordelingen av innhold på sonene. IMPORTFRI — leses av
 * skjermen, forhåndsvisningen, innstillingene og serveren. Designnotatet er
 * `docs/oppslagstavle.md` («Maler og plassering»).
 *
 * Hver mal har én STOR sone (`a`), null til tre små (`b`–`d`) og en **stripe** nederst som
 * bare tar den høyden innholdet trenger. Styret velger ikke sone for sone: hver blokk har
 * en PLASSERING (hovedfelt, sidefelt, stripe) og `fordelSoner` regner ut hvor den havner i
 * malen skjermen bruker. En sone med flere blokker roterer mellom dem.
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
};

const fr = (...x: number[]) => x.map((n) => `minmax(0,${n}fr)`).join(" ");

export const MALER: readonly Mal[] = [
  // --- Liggende -------------------------------------------------------------------------
  {
    id: "l-stor-to", navn: "Stor + to", retning: "liggende", soner: ["a", "b", "c"],
    kolonner: fr(1.6, 1), rader: fr(1.3, 1), omrader: ["a b", "a c"],
  },
  {
    id: "l-stor-tre", navn: "Stor + tre", retning: "liggende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1.6, 1), rader: fr(1, 1, 1), omrader: ["a b", "a c", "a d"],
  },
  {
    id: "l-to-like", navn: "To like", retning: "liggende", soner: ["a", "b"],
    kolonner: fr(1, 1), rader: fr(1), omrader: ["a b"],
  },
  {
    id: "l-tre-kolonner", navn: "Tre kolonner", retning: "liggende", soner: ["a", "b", "c"],
    kolonner: fr(1, 1, 1), rader: fr(1), omrader: ["a b c"],
  },
  {
    id: "l-rutenett", navn: "Rutenett 2 × 2", retning: "liggende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1, 1), rader: fr(1, 1), omrader: ["a b", "c d"],
  },
  {
    id: "l-fullskjerm", navn: "Fullskjerm", retning: "liggende", soner: ["a"],
    kolonner: fr(1), rader: fr(1), omrader: ["a"],
  },
  // --- Stående --------------------------------------------------------------------------
  {
    id: "s-stor-to", navn: "Stor + to", retning: "staende", soner: ["a", "b", "c"],
    kolonner: fr(1), rader: fr(1.5, 1, 0.7), omrader: ["a", "b", "c"],
  },
  {
    id: "s-stor-tre", navn: "Stor + tre", retning: "staende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1), rader: fr(1.5, 1, 1, 0.7), omrader: ["a", "b", "c", "d"],
  },
  {
    id: "s-stor-side", navn: "Stor + to side om side", retning: "staende", soner: ["a", "b", "c", "d"],
    kolonner: fr(1, 1), rader: fr(1.5, 1, 0.7), omrader: ["a a", "b c", "d d"],
  },
  {
    id: "s-to-like", navn: "To like", retning: "staende", soner: ["a", "b"],
    kolonner: fr(1), rader: fr(1, 1), omrader: ["a", "b"],
  },
  {
    id: "s-fullskjerm", navn: "Fullskjerm", retning: "staende", soner: ["a"],
    kolonner: fr(1), rader: fr(1), omrader: ["a"],
  },
];

export const STANDARD_MAL: Record<Retning, string> = { liggende: "l-stor-to", staende: "s-stor-to" };

export const malerFor = (retning: Retning) => MALER.filter((m) => m.retning === retning);

/** Malen skjermen skal bruke. Ukjent, eller en mal for den andre retningen ⇒ standardmalen. */
export function finnMal(id: string | null | undefined, retning: Retning): Mal {
  const m = MALER.find((x) => x.id === id && x.retning === retning);
  return m ?? MALER.find((x) => x.id === STANDARD_MAL[retning])!;
}

// ---------------------------------------------------------------------------------------
// Plassering
// ---------------------------------------------------------------------------------------

export const OMRADER = ["hoved", "side", "stripe", "av"] as const;
export type Omrade = (typeof OMRADER)[number];
export const OMRADE_ETIKETT: Record<Omrade, string> = {
  hoved: "Hovedfelt",
  side: "Sidefelt",
  stripe: "Stripe nederst",
  av: "Ikke vist",
};
export const OMRADE_BESKRIVELSE: Record<Omrade, string> = {
  hoved: "Det store feltet. Flere i hovedfeltet roterer.",
  side: "De mindre feltene ved siden av. Fordeles automatisk; flere enn det er plass til, roterer.",
  stripe: "En smal linje nederst — kompakt visning, alt side om side.",
  av: "Ligger i DriftIQ, men vises ikke på skjermene.",
};

/** Plasseringen når styret ikke har valgt noe. Egne blokker (vær, avganger) får `side`. */
export const STANDARD_PLASSERING: Record<InnebygdBlokk, Omrade> = {
  oppslag: "hoved",
  kalender: "side",
  kontakt: "side",
  tommedager: "stripe",
};

/** Rekkefølgen i sidefeltene: kalender først, så egne blokker, så kontakt og tømmedager. */
export const SIDE_REKKEFOLGE = (nokkel: string) =>
  nokkel === "oppslag" ? 0 : nokkel === "kalender" ? 1 : nokkel.startsWith("blokk:") ? 2 : nokkel === "kontakt" ? 3 : 4;

/**
 * Hvor blokkene havner i malen. `blokker` er de som skal vises på denne skjermen, med
 * område, i rekkefølge.
 *
 * - `hoved` → sone `a` (roterer).
 * - `side` → én per liten sone i rekkefølge; blir det flere enn sonene, roterer resten i
 *   den siste. Har malen ingen små soner (fullskjerm), roterer de i hovedfeltet.
 * - `stripe` → stripen.
 *
 * Blir en liten sone stående tom, er malen for stor for innholdet — styret bør velge en med
 * færre soner. Den står da tom i stedet for å fylles med noe tilfeldig.
 */
export function fordelSoner(mal: Mal, blokker: ReadonlyArray<{ nokkel: string; omrade: Omrade }>): Record<string, string[]> {
  const ut: Record<string, string[]> = Object.fromEntries([...mal.soner, STRIPE].map((s) => [s, []]));
  const i = (o: Omrade) => blokker.filter((b) => b.omrade === o).map((b) => b.nokkel);
  const sma = mal.soner.filter((s) => s !== "a");
  ut.a = i("hoved");
  ut[STRIPE] = i("stripe");
  const side = i("side");
  if (sma.length === 0) ut.a = [...ut.a!, ...side];
  else {
    side.forEach((n, k) => {
      const sone = sma[Math.min(k, sma.length - 1)]!;
      ut[sone] = [...ut[sone]!, n];
    });
  }
  return ut;
}
