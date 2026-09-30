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
// Felt — hva som står hvor, per skjerm
// ---------------------------------------------------------------------------------------

/** Blokknøklene per felt: `{ a: ["oppslag"], b: ["kalender"], stripe: ["tommedager"] }`. */
export type Felt = Record<string, string[]>;

/** Feltene i malen i lesefølge, med stripen sist. */
export const feltI = (mal: Mal): string[] => [...mal.soner, STRIPE];

export const feltNavn = (mal: Mal, felt: string): string =>
  felt === STRIPE ? "Stripe nederst" : `Felt ${mal.soner.indexOf(felt) + 1}`;

/**
 * Feltene slik de kan lagres: bare felt malen har, bare kjente nøkler (når `gyldige` er gitt),
 * og hver nøkkel én gang per felt. Ved malbytte beholdes feltene som finnes i begge maler.
 */
export function ryddFelt(mal: Mal, felt: Felt | null | undefined, gyldige?: ReadonlySet<string>): Felt {
  return Object.fromEntries(
    feltI(mal).map((f) => {
      const raa = felt?.[f];
      const nokler = Array.isArray(raa) ? raa.filter((n) => typeof n === "string" && (!gyldige || gyldige.has(n))) : [];
      return [f, [...new Set(nokler)]];
    }),
  );
}

/** Feltene i malen som står uten innhold. Stripen teller ikke: tom stripe tar ingen plass. */
export const tommeFelt = (mal: Mal, felt: Felt): string[] => mal.soner.filter((f) => (felt[f] ?? []).length === 0);

// ---------------------------------------------------------------------------------------
// Standardfeltene, og den gamle plasseringen per blokk (bare for migreringen)
// ---------------------------------------------------------------------------------------

export const OMRADER = ["hoved", "side", "stripe", "av"] as const;
export type Omrade = (typeof OMRADER)[number];

/** Hvor de innebygde blokkene havner på en ny skjerm. */
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
 * Fra område per blokk til felt i malen. Regelen fra da plasseringen ble valgt på innholdet;
 * brukes nå til standardfeltene for en ny skjerm og av `migrerPlasseringerTilFelt`.
 *
 * - `hoved` → felt `a` (roterer).
 * - `side` → én per lite felt i rekkefølge; blir det flere enn feltene, roterer resten i
 *   det siste. Har malen ingen små felt (fullskjerm), roterer de i `a`.
 * - `stripe` → stripen.
 */
export function fordelSoner(mal: Mal, blokker: ReadonlyArray<{ nokkel: string; omrade: Omrade }>): Felt {
  const ut: Felt = Object.fromEntries(feltI(mal).map((s) => [s, []]));
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

/** Feltene en ny skjerm starter med: oppslag i det store, kalender og kontakt ved siden av, tømmedager i stripen. */
export const standardFelt = (mal: Mal): Felt =>
  fordelSoner(
    mal,
    [...INNEBYGDE_BLOKKER]
      .sort((a, b) => SIDE_REKKEFOLGE(a) - SIDE_REKKEFOLGE(b))
      .map((n) => ({ nokkel: n, omrade: STANDARD_PLASSERING[n] })),
  );
