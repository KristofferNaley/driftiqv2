/**
 * BIR-adapteret — HTTP og tolkning mot bir.no. Ingen databasetilgang her; det ligger i
 * `birkobling.ts`. Designnotatet er `docs/bir.md`.
 *
 * ## Det finnes ikke noe dokumentert API
 *
 * Vi bruker de samme to flatene som BIRs egen nettside, uten innlogging:
 *
 * - **Søk** — `GET /api/search/AddressSearch?q=…` svarer JSON. Stabilt nok.
 * - **Tømmekalender** — `GET /adressesoek/toemmekalender/?rId=…` er HTML, tre måneder fram.
 *   Fraksjonen står BARE som ikonfil i `.category-row`. Dette er skraping, og det ryker den
 *   dagen BIR endrer markup — `tolkKalender` kaster da `BirFeil` med en melding som sier
 *   det, i stedet for å returnere en tom liste som ville sett ut som «ingen tømming».
 *
 * ## Hvitelista
 *
 * `TILLATTE_KALL` er de eneste stiene som hentes; alt annet kaster før noe går på nettet.
 * Bare GET. `tests/bir.test.ts` låser lista.
 */

import { BIR_IKON } from "./avfallsregler";

export const BIR_URL = "https://bir.no";

export const TILLATTE_KALL: ReadonlyArray<{ monster: RegExp; hva: string }> = [
  { monster: /^\/api\/search\/AddressSearch$/, hva: "søk etter adresse eller selskap" },
  { monster: /^\/adressesoek\/toemmekalender\/$/, hva: "tømmekalenderen for én oppføring" },
];

export class BirFeil extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = "BirFeil";
  }
}

async function hent(sti: string, sok: Record<string, string>, accept: string): Promise<string> {
  if (!TILLATTE_KALL.some((k) => k.monster.test(sti))) {
    throw new Error(`BIR-kall utenfor hvitelista: ${sti}`);
  }
  const url = new URL(`${BIR_URL}${sti}`);
  for (const [k, v] of Object.entries(sok)) url.searchParams.set(k, v);
  let svar: Response;
  try {
    svar = await fetch(url, {
      headers: { Accept: accept, "User-Agent": "DriftIQ oppslagstavle (+https://driftiq.no)" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BirFeil("Fikk ikke kontakt med bir.no");
  }
  if (!svar.ok) throw new BirFeil(`bir.no svarte ${svar.status}`);
  return svar.text();
}

export type BirTreff = { id: string; navn: string; sted: string | null; eiendom: string | null };

/** Tolker søkesvaret. Eksportert for testene. */
export function tolkSok(raa: unknown): BirTreff[] {
  if (!Array.isArray(raa)) throw new BirFeil("Uventet svar fra BIRs søk");
  return raa
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && typeof r.Id === "string")
    .map((r) => ({
      id: r.Id as string,
      navn: String(r.Title ?? ""),
      sted: typeof r.SubTitle === "string" ? r.SubTitle : null,
      eiendom: typeof r.RealEstateId === "string" ? r.RealEstateId : null,
    }));
}

export async function sokBir(q: string): Promise<BirTreff[]> {
  const tekst = await hent("/api/search/AddressSearch", { q, s: "false" }, "application/json");
  try {
    return tolkSok(JSON.parse(tekst));
  } catch (e) {
    if (e instanceof BirFeil) throw e;
    throw new BirFeil("Uventet svar fra BIRs søk");
  }
}

const MAANED: Record<string, number> = {
  januar: 1, februar: 2, mars: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

export type Tommedag = { fraksjon: string; dato: string };

const tekst = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();

/**
 * Tømmekalenderen fra HTML. Struktur (september 2026):
 *
 *   .month-container > h2.month-title «September 2026»
 *     .category-row > .icon img[src=…/trashicons/restavfall.svg]
 *                   > .date-item > .date-item-date «7. sep»
 *
 * Året og måneden tas fra månedsoverskriften, dagen fra datoen. Eksportert for testene.
 */
export function tolkKalender(html: string): Tommedag[] {
  const maaneder = html.split(/class="month-container"/).slice(1);
  if (maaneder.length === 0) {
    throw new BirFeil("Kjente ikke igjen tømmekalenderen fra BIR — nettsiden kan ha endret seg");
  }
  const ut: Tommedag[] = [];
  for (const blokk of maaneder) {
    const tittel = /class="month-title"[^>]*>([^<]+)</.exec(blokk)?.[1];
    const [mNavn, aar] = tekst(tittel ?? "").toLowerCase().split(" ");
    const m = MAANED[mNavn ?? ""];
    if (!m || !/^\d{4}$/.test(aar ?? "")) {
      throw new BirFeil(`Kjente ikke igjen månedsoverskriften «${tekst(tittel ?? "")}» fra BIR`);
    }
    for (const rad of blokk.split(/class="category-row"/).slice(1)) {
      const ikon = /trashicons\/([A-Za-z]+)\.svg/.exec(rad)?.[1];
      if (!ikon) continue;
      const fraksjon = BIR_IKON[ikon] ?? ikon;
      for (const d of rad.matchAll(/class="date-item-date"[^>]*>([^<]+)</g)) {
        const dag = /^(\d{1,2})\./.exec(tekst(d[1]!))?.[1];
        if (!dag) continue;
        ut.push({ fraksjon, dato: `${aar}-${String(m).padStart(2, "0")}-${dag.padStart(2, "0")}` });
      }
    }
  }
  return ut;
}

export async function hentKalender(birId: string): Promise<Tommedag[]> {
  if (!/^[0-9a-f-]{36}$/i.test(birId)) throw new BirFeil("Ugyldig BIR-id");
  return tolkKalender(await hent("/adressesoek/toemmekalender/", { rId: birId }, "text/html"));
}
