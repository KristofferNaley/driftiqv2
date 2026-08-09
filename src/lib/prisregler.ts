/**
 * Prismodellen — regnestykket, uten database.
 *
 * Ingen importer i denne fila. Både prismodellsiden og fakturering i kundedetaljen regner
 * ut totalen mens man skriver i skjemaet, og de er klientkomponenter. Se `nivaer.ts` for
 * hvorfor det er et krav.
 *
 * At regelen bor ett sted er ikke kosmetikk: v1 regnet grunnpakken i backend
 * (`compute_base_fee`) og totalen i frontend (`ContractModal`), og et snapshot av
 * grunnpakken ble lagret på kontrakten. Da MÅ de to være enige — ellers viser
 * fakturagrunnlaget ett tall og kontrakten et annet.
 */

/** Ett trappetrinn: `rate` kroner per andel for andelene mellom `fra` og `til`. */
export type Trinn = { fra: number; til: number; sats: number };

/** Standardtrinnene fra v1. Brukes når prismodellen opprettes første gang. */
export const STANDARDTRINN: readonly Trinn[] = [
  { fra: 1, til: 50, sats: 280 },
  { fra: 51, til: 150, sats: 180 },
  { fra: 151, til: 400, sats: 120 },
  { fra: 401, til: 600, sats: 80 },
];

export const STANDARD_GULVPRIS = 8000;

/** Standard årspris per tilleggsmodul. */
export const STANDARD_MODULPRISER: Readonly<Record<string, number>> = {
  internkontroll: 12000,
  parkering: 8500,
  vedlikehold: 9000,
  arshjul: 2500,
  dokumentarkiv: 3500,
};

/**
 * Degressiv trappetrinnsberegning: hvert trinn gjelder KUN andelene innenfor sitt eget
 * intervall — et lag med 200 andeler betaler 280 for de 50 første, 180 for de neste 100 og
 * 120 for de siste 50. Ikke 120 for alle 200.
 *
 * Resultatet kan aldri bli lavere enn gulvprisen. Et lite sameie koster like mye å drifte
 * som et stort i alt annet enn andeler.
 */
export function grunnpakke(
  antallAndeler: number | null | undefined,
  gulvpris: number,
  trinn: readonly Trinn[],
): number {
  const andeler = antallAndeler ?? 0;
  let sum = 0;
  for (const t of [...trinn].sort((a, b) => a.fra - b.fra)) {
    if (andeler < t.fra) continue;
    const iTrinnet = Math.min(andeler, t.til) - t.fra + 1;
    if (iTrinnet > 0) sum += iTrinnet * t.sats;
  }
  return Math.max(sum, gulvpris);
}

/** Én linje i regnestykket — hva et enkelt trinn bidrar med. */
export type Trinnlinje = Trinn & { andelerITrinnet: number; sum: number };

/**
 * Samme regnestykke som `grunnpakke()`, men med mellomregningen synlig.
 *
 * Brukes av simulatoren på prismodellsiden. Poenget er å kunne se at et lag på 200 andeler
 * treffer tre trinn — den degressive modellen er ikke innlysende før man ser den brutt opp,
 * og et enkelt totaltall gjør det umulig å oppdage at et trinn er feil satt opp.
 *
 * Merk at gulvprisen IKKE er med her: den er en grense på totalen, ikke et trinn.
 */
export function grunnpakkeSpesifisert(
  antallAndeler: number | null | undefined,
  trinn: readonly Trinn[],
): Trinnlinje[] {
  const andeler = antallAndeler ?? 0;
  const linjer: Trinnlinje[] = [];
  for (const t of [...trinn].sort((a, b) => a.fra - b.fra)) {
    if (andeler < t.fra) continue;
    const andelerITrinnet = Math.min(andeler, t.til) - t.fra + 1;
    if (andelerITrinnet > 0) {
      linjer.push({ ...t, andelerITrinnet, sum: andelerITrinnet * t.sats });
    }
  }
  return linjer;
}

/**
 * Årssummen på en kontrakt: (grunnpakke + moduler) minus rabatt.
 *
 * `grunnpakke` er snapshotet som ble lagret da kontrakten sist ble endret, ikke en ny
 * beregning. Endrer vi satsene i morgen, skal ikke inngåtte avtaler endre seg av seg selv.
 */
export function arssum(kontrakt: {
  grunnpakke?: number | null;
  arsavgift?: number | null;
  moduler?: ReadonlyArray<{ pris?: number | null }> | null;
  rabattProsent?: number | null;
}): number {
  const modulsum = (kontrakt.moduler ?? []).reduce((n, m) => n + (m.pris ?? 0), 0);
  const brutto = (kontrakt.grunnpakke ?? kontrakt.arsavgift ?? 0) + modulsum;
  return Math.round(brutto * (1 - (kontrakt.rabattProsent ?? 0) / 100));
}

/**
 * Tolker trinn fra databasens JSON.
 *
 * v1 lagret feltene engelske (`from`/`to`/`rate`), og migrerte rader har fortsatt den
 * formen. Begge former godtas her, av samme grunn som `lesKategorier` godtar `value`/`label`
 * — den gamle formen finnes i produksjonsdata og forsvinner ikke av at vi skifter navn.
 *
 * Ugyldig JSON gir standardtrinnene, ikke en tom liste: en tom liste hadde gjort at alle
 * kunder plutselig kostet gulvprisen.
 */
export function lesTrinn(json: string | null | undefined): Trinn[] {
  if (!json) return [...STANDARDTRINN];
  try {
    const rader = JSON.parse(json);
    if (!Array.isArray(rader)) return [...STANDARDTRINN];
    const trinn = rader
      .map((r): Trinn | null => {
        const fra = Number(r?.fra ?? r?.from);
        const til = Number(r?.til ?? r?.to);
        const sats = Number(r?.sats ?? r?.rate);
        if (!Number.isFinite(fra) || !Number.isFinite(til) || !Number.isFinite(sats)) return null;
        return { fra, til, sats };
      })
      .filter((t): t is Trinn => t !== null);
    return trinn.length > 0 ? trinn : [...STANDARDTRINN];
  } catch {
    return [...STANDARDTRINN];
  }
}

/** Modulpriser fra databasens JSON. Ugyldig verdi ⇒ standardprisene. */
export function lesModulpriser(json: string | null | undefined): Record<string, number> {
  if (!json) return { ...STANDARD_MODULPRISER };
  try {
    const o = JSON.parse(json);
    if (!o || typeof o !== "object" || Array.isArray(o)) return { ...STANDARD_MODULPRISER };
    const ut: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      const n = Number(v);
      if (Number.isFinite(n)) ut[k] = n;
    }
    return ut;
  } catch {
    return { ...STANDARD_MODULPRISER };
  }
}

/**
 * En JSON-liste med strenger. Brukes til `hiddenModules` og `leadsNotifyEmails`.
 *
 * Faller tilbake til tom liste ved feil — og det er riktig vei her, i motsetning til
 * trinnene: en ødelagt `hiddenModules` skal ikke skjule moduler, og en ødelagt
 * mottakerliste skal ikke stoppe varslene (kallstedet faller da tilbake på miljøvariabelen).
 */
export function lesStrengliste(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Kroner uten desimaler, norsk format. */
export const kroner = (n: number) => `${Math.round(n).toLocaleString("nb-NO")} kr`;
