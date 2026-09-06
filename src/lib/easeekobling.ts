/**
 * Easee-koblingen per org, laderne i anlegget og månedsforbruket. Designnotatet er
 * `docs/easee.md`; HTTP-laget er `easee.ts`.
 *
 * Tokenene fra Easee ligger kryptert i `easee_settings` (`lib/kryptering.ts`) og
 * dekrypteres bare her, i det øyeblikket et kall skal gjøres — se `medToken()`, som også
 * fornyer dem. Passordet brukes én gang i `kobleTil` og lagres aldri. `hentKobling()`
 * returnerer aldri et token.
 *
 * ## Hva som er sannhet hvor
 *
 * Easee eier laderen: tilstand og kWh avgjøres der. `easee_chargers` er DriftIQs speil av
 * det, friskes opp når Lading-fanen åpnes, pluss det Easee ikke vet — hvilken
 * parkeringsplass laderen står på. `easee_charger_usage` er månedsforbruket lagret, så
 * avregningen kan gjøres om igjen senere og uten å treffe Easees ratebegrensning.
 * Feil fra Easee ved oppfrisking RETURNERES (`feil`-feltet), så fanen vises med sist
 * kjente tilstand i stedet for å velte.
 *
 * ## Én fjernbar pakke
 *
 * Eneste kobling inn i resten av appen: `kobleLaderTilPlass` setter `hasCharger` på
 * plassen (data, ikke skjema) — så Plasser-fanen sier det samme som Lading-fanen.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { easeeChargerHours, easeeChargerUsage, easeeChargers, easeePricePlans, easeeSessions, easeeSettings, powerPrices } from "../db/schema/easee";
import { unitOwners } from "../db/schema/okonomi";
import { parkingLeases, parkingSpots } from "../db/schema/parking";
import { units } from "../db/schema/units";
import type { Aktor } from "./aktor";
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import {
  EaseeFeil,
  type EaseeSite,
  type EaseeToken,
  fornyToken,
  hentAnlegg,
  hentAnleggDetalj,
  hentAnleggTilstand,
  hentMaanedsforbruk,
  hentOkter as hentOkterFraEasee,
  hentProfil,
  hentTimesforbruk,
  laderneI,
  loggInn,
  tilstandeneI,
} from "./easee";
import { loggHendelse } from "./hendelser";
import { dekrypter, krypter, krypteringErKonfigurert } from "./kryptering";
import {
  KRAFTMODELLER,
  PRISOMRADER,
  type Prisplan,
  beregnKostnad,
  gjeldendePlan,
  maanedsgrenser,
} from "./laderegler";
import { tilCsv, tilKronerTekst } from "./okonomiregler";
import { hentSpotpriser, osloDato } from "./spotpris";

const MODUL = "parkering" as const;

/** Tilstanden friskes ikke opp oftere enn dette — fanen kan åpnes mange ganger på rad. */
export const TILSTAND_HOLDBARHET_MS = 30 * 1000;
/** Månedsforbruket hentes på nytt først etter dette; «Oppdater»-knappen tvinger. */
export const FORBRUK_HOLDBARHET_MS = 6 * 60 * 60 * 1000;
/** Hvor langt tilbake forbruket hentes — ett år pluss inneværende måned. */
export const FORBRUK_MAANEDER = 13;

/** Access token fornyes når det er under dette igjen. */
export const TOKEN_MARGIN_MS = 5 * 60 * 1000;

export const koblingInn = z.object({
  /** E-post eller mobilnummer med landkode — det man logger inn i Easee-appen med. */
  userName: z.string().trim().min(3, "Brukernavn mangler"),
  password: z.string().min(1, "Passord mangler"),
  /** Anlegget laderne hører til. Velges automatisk hvis nøkkelen bare når ett. */
  siteId: z.number().int().positive().nullish(),
});

/** Timesforbruk og økter hentes så langt tilbake ved første synk — prising fra da av. */
export const SYNK_TILBAKEFYLL_DAGER = 92;
/** Hver synk henter fra siste kjente time minus dette — Easee kan etterjustere de siste timene. */
export const SYNK_OVERLAPP_TIMER = 48;
/**
 * Easee avviser timesforbruk for mer enn ~31 dager i ett kall («Too many timeperiods in
 * specified interval», målt 06.09.2026: 31 dager gikk, 45 ikke). Perioden deles derfor i
 * vinduer på 28 dager; øktene deles likt for sikkerhets skyld.
 */
export const SYNK_VINDU_DAGER = 28;
/** Spotpriser hentes bakover så mange dager de mangler (rapporten går sjelden lenger tilbake uten data fra før). */
export const SPOT_TILBAKEFYLL_DAGER = 92;

export const prisplanInn = z.object({
  validFrom: z.string().date(),
  name: z.string().trim().min(1, "Gi planen et navn").max(80),
  kraftModel: z.enum(KRAFTMODELLER),
  kraftOre: z.number().int().min(0).max(100_000).default(0),
  paaslagOre: z.number().int().min(0).max(100_000).default(0),
  priceArea: z.enum(PRISOMRADER).nullish(),
  mvaProsent: z.number().int().min(0).max(100).default(25),
  nettDagOre: z.number().int().min(0).max(100_000).default(0),
  nettNattOre: z.number().int().min(0).max(100_000).default(0),
  nattFra: z.number().int().min(0).max(23).default(22),
  nattTil: z.number().int().min(0).max(23).default(6),
  helgSomNatt: z.boolean().default(true),
  fastleddOre: z.number().int().min(0).max(10_000_000).default(0),
  note: z.string().trim().max(500).nullish(),
});

export const laderPlassInn = z.object({
  /** null = løsne laderen fra plassen. */
  spotId: z.string().trim().min(1).nullable(),
});

/**
 * Feil fra Easee blir `ApiFeil` med Easees melding — ikke «Noe gikk galt».
 * ALDRI 502 eller 504 her (Cloudflare-tunnelen bytter dem ut med sin egen HTML-side):
 * avviste forespørsler (4xx fra Easee) er 400 hos oss; alt annet 503.
 */
function tilApiFeil(e: unknown): never {
  if (e instanceof EaseeFeil) throw new ApiFeil(e.status >= 400 && e.status < 500 ? 400 : 503, e.message);
  if (e instanceof Error && e.name === "TimeoutError") throw new ApiFeil(503, "Easee svarte ikke i tide");
  throw e;
}

// ---------------------------------------------------------------------------------------
// Koblingen
// ---------------------------------------------------------------------------------------

/** Status uten hemmeligheter — det Integrasjoner-fanen viser. */
export async function hentKobling(db: Db, orgId: string) {
  const r = await db.select().from(easeeSettings).where(eq(easeeSettings.orgId, orgId)).limit(1);
  const k = r[0];
  const ladere = k
    ? await db
        .select({ id: easeeChargers.id, spotId: easeeChargers.spotId })
        .from(easeeChargers)
        .where(and(eq(easeeChargers.orgId, orgId), eq(easeeChargers.active, true)))
    : [];
  return {
    konfigurert: { kryptering: krypteringErKonfigurert() },
    kobling: k
      ? {
          siteId: k.siteId,
          siteName: k.siteName,
          userName: k.userName,
          accountEmail: k.accountEmail,
          tokenExpiresAt: k.tokenExpiresAt,
          connectedBy: k.connectedBy,
          createdAt: k.createdAt,
          lastError: k.lastError,
          lastCheckedAt: k.lastCheckedAt,
        }
      : null,
    ladere: { antall: ladere.length, koblet: ladere.filter((l) => l.spotId).length },
  };
}

async function hentRad(db: Db, orgId: string) {
  const r = await db.select().from(easeeSettings).where(eq(easeeSettings.orgId, orgId)).limit(1);
  if (!r[0]) throw ikkeFunnet("Easee-kobling");
  return r[0];
}

async function noterFeil(db: Db, orgId: string, id: string, feil: string | null, naa = new Date()) {
  await db
    .update(easeeSettings)
    .set({ lastError: feil ? feil.slice(0, 500) : null, lastCheckedAt: naa })
    .where(and(eq(easeeSettings.id, id), eq(easeeSettings.orgId, orgId)));
}

function tokenFelter(t: EaseeToken, naa: Date) {
  return {
    accessTokenEnc: krypter(t.accessToken),
    refreshTokenEnc: krypter(t.refreshToken),
    tokenExpiresAt: new Date(naa.getTime() + (t.expiresIn ?? 3600) * 1000),
  };
}

/**
 * Kjører `fn` med et gyldig access token. Fornyes med refresh token når det er under
 * fem minutter igjen — og én gang til hvis Easee likevel svarer 401 (tokenet kan være
 * ugyldiggjort før utløp). Feiler fornyingen med 4xx, er innloggingen død: meldingen ber
 * om ny tilkobling, og raden står med `last_error` til noen gjør det.
 */
async function medToken<T>(db: Db, orgId: string, rad: typeof easeeSettings.$inferSelect, naa: Date, fn: (token: string) => Promise<T>): Promise<T> {
  let access = dekrypter(rad.accessTokenEnc);
  let refresh = dekrypter(rad.refreshTokenEnc);
  const forny = async () => {
    let nytt: EaseeToken;
    try {
      nytt = await fornyToken(access, refresh);
    } catch (e) {
      if (e instanceof EaseeFeil && e.status >= 400 && e.status < 500) {
        throw new EaseeFeil(401, "Easee-innloggingen er utløpt — koble til på nytt under Innstillinger → Integrasjoner");
      }
      throw e;
    }
    access = nytt.accessToken;
    refresh = nytt.refreshToken || refresh;
    await db
      .update(easeeSettings)
      .set(tokenFelter({ ...nytt, refreshToken: refresh }, naa))
      .where(and(eq(easeeSettings.id, rad.id), eq(easeeSettings.orgId, orgId)));
  };
  if (rad.tokenExpiresAt.getTime() - naa.getTime() < TOKEN_MARGIN_MS) await forny();
  try {
    return await fn(access);
  } catch (e) {
    if (!(e instanceof EaseeFeil && e.status === 401)) throw e;
    await forny();
    return fn(access);
  }
}

const anleggNavn = (s: EaseeSite) => `${s.name}${s.address?.street ? `, ${s.address.street}${s.address.buildingNumber ? ` ${s.address.buildingNumber}` : ""}` : ""} (id ${s.id})`;

/**
 * Kobler til: brukernavn og passord byttes i tokener hos Easee (passordet lagres aldri),
 * anlegget velges — automatisk når kontoen bare når ett — og laderne speiles inn.
 * Ingenting lagres før Easee har svart ja.
 */
export async function kobleTil(db: Db, orgId: string, av: Aktor, data: z.infer<typeof koblingInn>, naa = new Date()) {
  if (!krypteringErKonfigurert()) throw new ApiFeil(503, "Koblingen er ikke satt opp på serveren (mangler nøkkel for kryptering).");
  let token: EaseeToken;
  let epost: string | null = null;
  let anlegg: EaseeSite[];
  try {
    token = await loggInn(data.userName, data.password);
    const profil = await hentProfil(token.accessToken);
    epost = profil.eMail ?? profil.phoneNo ?? null;
    anlegg = await hentAnlegg(token.accessToken);
  } catch (e) {
    tilApiFeil(e);
  }
  if (anlegg.length === 0) throw ugyldig("Kontoen når ingen anlegg i Easee. Bruk kontoen som er site owner for anlegget.");

  const valgt = data.siteId ? anlegg.find((s) => s.id === data.siteId) ?? null : anlegg.length === 1 ? anlegg[0]! : null;
  if (data.siteId && !valgt) throw ugyldig("Kontoen når ikke det oppgitte anlegget.");
  if (!valgt) throw ugyldig(`Velg hvilket anlegg laderne står i: ${anlegg.slice(0, 10).map(anleggNavn).join("; ")}`);

  let ladere: ReturnType<typeof laderneI>;
  try {
    ladere = laderneI(await hentAnleggDetalj(token.accessToken, valgt.id));
  } catch (e) {
    tilApiFeil(e);
  }

  const felter = {
    userName: data.userName,
    ...tokenFelter(token, naa),
    siteId: valgt.id,
    siteName: valgt.name,
    accountEmail: epost,
    connectedBy: av.navn,
    connectedByUserId: av.brukerId,
    lastError: null,
    lastCheckedAt: naa,
  };
  const finnes = await db.select({ id: easeeSettings.id }).from(easeeSettings).where(eq(easeeSettings.orgId, orgId)).limit(1);
  if (finnes[0]) {
    await db.update(easeeSettings).set(felter).where(and(eq(easeeSettings.id, finnes[0].id), eq(easeeSettings.orgId, orgId)));
  } else {
    await db.insert(easeeSettings).values({ id: randomUUID(), orgId, ...felter });
  }
  await speilLadere(db, orgId, ladere);
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "easee", entitetId: null,
    hendelse: `Koblet ladeanlegget til Easee-anlegget «${valgt.name}» (${ladere.length} lader${ladere.length === 1 ? "" : "e"})`,
  });
  return hentKobling(db, orgId);
}

/**
 * Frakobling fjerner tokenene, men lar laderne og forbruket stå: koblingen lader → plass
 * og månedstallene er styrets avregningsgrunnlag, og de påvirkes ikke av at DriftIQ
 * glemmer innloggingen.
 */
export async function kobleFra(db: Db, orgId: string, av: Aktor) {
  const k = await hentRad(db, orgId);
  await db.delete(easeeSettings).where(and(eq(easeeSettings.id, k.id), eq(easeeSettings.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "easee", entitetId: null,
    hendelse: `Koblet fra Easee-anlegget «${k.siteName}»`,
  });
}

// ---------------------------------------------------------------------------------------
// Laderne
// ---------------------------------------------------------------------------------------

/**
 * Speiler laderlista fra Easee: nye settes inn, kjente får oppdatert navn/kurs, og de
 * som er borte fra anlegget settes inaktive (raden og forbruket beholdes).
 */
async function speilLadere(db: Db, orgId: string, ladere: ReturnType<typeof laderneI>) {
  const kjente = await db.select().from(easeeChargers).where(eq(easeeChargers.orgId, orgId));
  const perId = new Map(kjente.map((k) => [k.chargerId, k]));
  const sett = new Set<string>();
  for (const l of ladere) {
    sett.add(l.id);
    const k = perId.get(l.id);
    if (k) {
      if (k.name !== l.name || k.circuitName !== l.circuitName || !k.active) {
        await db
          .update(easeeChargers)
          .set({ name: l.name, circuitName: l.circuitName, active: true })
          .where(and(eq(easeeChargers.id, k.id), eq(easeeChargers.orgId, orgId)));
      }
    } else {
      await db.insert(easeeChargers).values({ id: randomUUID(), orgId, chargerId: l.id, name: l.name, circuitName: l.circuitName });
    }
  }
  for (const k of kjente) {
    if (k.active && !sett.has(k.chargerId)) {
      await db.update(easeeChargers).set({ active: false }).where(and(eq(easeeChargers.id, k.id), eq(easeeChargers.orgId, orgId)));
    }
  }
}

/** Tilstanden til alle laderne — ett kall mot Easee, én oppdatering per lader. */
async function friskOppTilstand(db: Db, orgId: string, token: string, siteId: number, naa: Date) {
  const tilstander = tilstandeneI(await hentAnleggTilstand(token, siteId));
  const rader = await db.select().from(easeeChargers).where(and(eq(easeeChargers.orgId, orgId), eq(easeeChargers.active, true)));
  for (const r of rader) {
    const t = tilstander.get(r.chargerId);
    if (!t) continue;
    await db
      .update(easeeChargers)
      .set({
        opMode: t.chargerOpMode ?? null,
        isOnline: t.isOnline ?? null,
        totalPower: t.totalPower ?? null,
        sessionEnergy: t.sessionEnergy ?? null,
        lifetimeEnergy: t.lifetimeEnergy ?? null,
        stateCheckedAt: naa,
      })
      .where(and(eq(easeeChargers.id, r.id), eq(easeeChargers.orgId, orgId)));
  }
}

/**
 * Første dag i måneden `antall - 1` måneder tilbake, i UTC — Easee tidfester månedene
 * som «2026-07-01T00:00:00+00:00», og grensene sendes i samme form.
 */
export function forbrukFra(naa: Date, antall = FORBRUK_MAANEDER): Date {
  return new Date(Date.UTC(naa.getUTCFullYear(), naa.getUTCMonth() - (antall - 1), 1));
}

/**
 * Første dag i NESTE måned (UTC). Lært mot ekte Easee 06.09.2026: med `to` = nå kom
 * inneværende måned ikke med i svaret i det hele tatt; med `to` = 1. i neste måned kom
 * den, med tallet så langt. Perioden må altså dekke hele måneden for at den skal telle.
 */
export function forbrukTil(naa: Date): Date {
  return new Date(Date.UTC(naa.getUTCFullYear(), naa.getUTCMonth() + 1, 1));
}

/** Månedsforbruket per lader fra Easee → `easee_charger_usage` (upsert på lader+år+måned). */
async function friskOppForbruk(db: Db, orgId: string, token: string, naa: Date, bare?: string[]) {
  const rader = await db.select().from(easeeChargers).where(and(eq(easeeChargers.orgId, orgId), eq(easeeChargers.active, true)));
  for (const r of rader) {
    if (bare && !bare.includes(r.id)) continue;
    const maaneder = await hentMaanedsforbruk(token, r.chargerId, forbrukFra(naa), forbrukTil(naa));
    for (const m of maaneder) {
      const kwh = Number(m.consumption) || 0;
      const finnes = await db
        .select({ id: easeeChargerUsage.id })
        .from(easeeChargerUsage)
        .where(and(eq(easeeChargerUsage.orgId, orgId), eq(easeeChargerUsage.chargerRowId, r.id), eq(easeeChargerUsage.year, m.year), eq(easeeChargerUsage.month, m.month!)))
        .limit(1);
      if (finnes[0]) {
        await db
          .update(easeeChargerUsage)
          .set({ kwh, fetchedAt: naa })
          .where(and(eq(easeeChargerUsage.id, finnes[0].id), eq(easeeChargerUsage.orgId, orgId)));
      } else {
        await db.insert(easeeChargerUsage).values({ id: randomUUID(), orgId, chargerRowId: r.id, year: m.year, month: m.month!, kwh, fetchedAt: naa });
      }
    }
    await db.update(easeeChargers).set({ usageCheckedAt: naa }).where(and(eq(easeeChargers.id, r.id), eq(easeeChargers.orgId, orgId)));
  }
}

function tilVisning(r: typeof easeeChargers.$inferSelect) {
  return {
    id: r.id,
    chargerId: r.chargerId,
    name: r.name,
    circuitName: r.circuitName,
    spotId: r.spotId,
    active: r.active,
    opMode: r.opMode,
    isOnline: r.isOnline,
    totalPower: r.totalPower,
    sessionEnergy: r.sessionEnergy,
    lifetimeEnergy: r.lifetimeEnergy,
    stateCheckedAt: r.stateCheckedAt,
    usageCheckedAt: r.usageCheckedAt,
  };
}

/**
 * Alt Lading-fanen trenger: koblingsstatus, laderne med plass og disponent, og
 * månedsforbruket. Med kobling friskes tilstanden opp (ett kall) når den er eldre enn
 * `TILSTAND_HOLDBARHET_MS`, og forbruket når det er eldre enn `FORBRUK_HOLDBARHET_MS`
 * eller `frisk === "alt"` (knappen «Oppdater fra Easee» — henter da også laderlista på
 * nytt). Svikter Easee, kommer svaret likevel, med `feil` satt og sist kjente tall.
 */
export async function hentLading(db: Db, orgId: string, opts: { frisk?: boolean | "alt"; naa?: Date } = {}) {
  const naa = opts.naa ?? new Date();
  const kobling = (await db.select().from(easeeSettings).where(eq(easeeSettings.orgId, orgId)).limit(1))[0] ?? null;
  let feil: string | null = null;

  if (kobling && opts.frisk !== false) {
    try {
      const ladere = await db.select().from(easeeChargers).where(and(eq(easeeChargers.orgId, orgId), eq(easeeChargers.active, true)));
      const tilstandGammel = ladere.some((l) => !l.stateCheckedAt || naa.getTime() - l.stateCheckedAt.getTime() > TILSTAND_HOLDBARHET_MS);
      const trengerForbruk = ladere.filter((l) => !l.usageCheckedAt || naa.getTime() - l.usageCheckedAt.getTime() > FORBRUK_HOLDBARHET_MS).map((l) => l.id);
      const maaRinge = opts.frisk === "alt" || tilstandGammel || ladere.length === 0 || trengerForbruk.length > 0;
      if (maaRinge) {
        await medToken(db, orgId, kobling, naa, async (token) => {
          if (opts.frisk === "alt") {
            await speilLadere(db, orgId, laderneI(await hentAnleggDetalj(token, kobling.siteId)));
          }
          if (opts.frisk === "alt" || tilstandGammel || ladere.length === 0) {
            await friskOppTilstand(db, orgId, token, kobling.siteId, naa);
          }
          if (opts.frisk === "alt") await friskOppForbruk(db, orgId, token, naa);
          else if (trengerForbruk.length > 0) await friskOppForbruk(db, orgId, token, naa, trengerForbruk);
          if (opts.frisk === "alt") await synkTimerOgOkter(db, orgId, token, naa);
        });
        if (opts.frisk === "alt") await synkSpotpriserFor(db, orgId, naa);
        await noterFeil(db, orgId, kobling.id, null, naa);
      }
    } catch (e) {
      feil = e instanceof Error ? e.message : String(e);
      await noterFeil(db, orgId, kobling.id, feil, naa);
    }
  }

  const rader = await db
    .select()
    .from(easeeChargers)
    .where(eq(easeeChargers.orgId, orgId))
    .orderBy(asc(easeeChargers.name));
  const plasser = await db
    .select({ id: parkingSpots.id, number: parkingSpots.number, holderName: parkingSpots.holderName, unitLabel: parkingSpots.unitLabel })
    .from(parkingSpots)
    .where(eq(parkingSpots.orgId, orgId));
  const avtaler = await db
    .select({ spotId: parkingLeases.spotId, tenantName: parkingLeases.tenantName, powerBilling: parkingLeases.powerBilling })
    .from(parkingLeases)
    .where(and(eq(parkingLeases.orgId, orgId), isNull(parkingLeases.endedAt)));
  const plassMedId = new Map(plasser.map((p) => [p.id, p]));
  const avtaleMedPlass = new Map(avtaler.map((a) => [a.spotId, a]));
  const forbruk = await db
    .select({ chargerRowId: easeeChargerUsage.chargerRowId, year: easeeChargerUsage.year, month: easeeChargerUsage.month, kwh: easeeChargerUsage.kwh })
    .from(easeeChargerUsage)
    .where(eq(easeeChargerUsage.orgId, orgId));

  return {
    koblet: Boolean(kobling),
    feil,
    anlegg: kobling ? { siteName: kobling.siteName } : null,
    ladere: rader.map((r) => {
      const p = r.spotId ? plassMedId.get(r.spotId) ?? null : null;
      const a = r.spotId ? avtaleMedPlass.get(r.spotId) ?? null : null;
      return {
        ...tilVisning(r),
        plass: p ? { number: p.number, holderName: p.holderName, unitLabel: p.unitLabel } : null,
        avtale: a ? { tenantName: a.tenantName, powerBilling: a.powerBilling } : null,
      };
    }),
    forbruk,
  };
}

/**
 * Kobler en lader til en parkeringsplass — eller løsner den (`spotId: null`). Én lader
 * per plass: står en annen aktiv lader allerede på plassen, avvises det. Plassen får
 * `hasCharger` satt, så Plasser-fanen og Lading-fanen sier det samme.
 */
export async function kobleLaderTilPlass(db: Db, orgId: string, av: Aktor, chargerRowId: string, data: z.infer<typeof laderPlassInn>) {
  const r = (await db.select().from(easeeChargers).where(and(eq(easeeChargers.id, chargerRowId), eq(easeeChargers.orgId, orgId))).limit(1))[0];
  if (!r) throw ikkeFunnet("Lader");

  let plassNavn: string | null = null;
  if (data.spotId) {
    const p = (await db.select().from(parkingSpots).where(and(eq(parkingSpots.id, data.spotId), eq(parkingSpots.orgId, orgId))).limit(1))[0];
    if (!p) throw ikkeFunnet("Parkeringsplass");
    const opptatt = await db
      .select({ name: easeeChargers.name })
      .from(easeeChargers)
      .where(and(eq(easeeChargers.orgId, orgId), eq(easeeChargers.spotId, p.id), eq(easeeChargers.active, true), ne(easeeChargers.id, r.id)))
      .limit(1);
    if (opptatt[0]) throw ugyldig(`Plass ${p.number} har allerede laderen «${opptatt[0].name}» — løsne den først.`);
    plassNavn = p.number;
    if (!p.hasCharger || !p.chargerLabel) {
      await db
        .update(parkingSpots)
        .set({ hasCharger: true, chargerLabel: p.chargerLabel || `Easee ${r.name}` })
        .where(and(eq(parkingSpots.id, p.id), eq(parkingSpots.orgId, orgId)));
    }
  }

  await db.update(easeeChargers).set({ spotId: data.spotId }).where(and(eq(easeeChargers.id, r.id), eq(easeeChargers.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "easee_lader", entitetId: r.id,
    hendelse: plassNavn
      ? `Koblet laderen «${r.name}» (${r.chargerId}) til plass ${plassNavn}`
      : `Løsnet laderen «${r.name}» (${r.chargerId}) fra plassen`,
  });
  return tilVisning((await db.select().from(easeeChargers).where(and(eq(easeeChargers.id, r.id), eq(easeeChargers.orgId, orgId))).limit(1))[0]!);
}

// ---------------------------------------------------------------------------------------
// Synk av timesforbruk, økter og spotpriser — jobben «easee-synk» og «Oppdater fra Easee»
// ---------------------------------------------------------------------------------------

/**
 * Timesforbruk og økter for alle aktive ladere, fra siste kjente time minus overlapp (Easee
 * kan etterjustere), eller `SYNK_TILBAKEFYLL_DAGER` tilbake første gang. Upsert på
 * (lader, time) og (lader, Easee-øktid). Én kall per lader per type — økt-endepunktet
 * tåler 10 per time per lader, så dette skal ikke kalles ved visning.
 */
export async function synkTimerOgOkter(db: Db, orgId: string, token: string, naa: Date) {
  const ladere = await db.select().from(easeeChargers).where(and(eq(easeeChargers.orgId, orgId), eq(easeeChargers.active, true)));
  let timer = 0;
  let okter = 0;
  for (const l of ladere) {
    const siste = (
      await db
        .select({ hourStart: easeeChargerHours.hourStart })
        .from(easeeChargerHours)
        .where(and(eq(easeeChargerHours.orgId, orgId), eq(easeeChargerHours.chargerRowId, l.id)))
        .orderBy(desc(easeeChargerHours.hourStart))
        .limit(1)
    )[0];
    const fra = siste
      ? new Date(siste.hourStart.getTime() - SYNK_OVERLAPP_TIMER * 3600 * 1000)
      : new Date(naa.getTime() - SYNK_TILBAKEFYLL_DAGER * 24 * 3600 * 1000);
    const til = new Date(naa.getTime() + 3600 * 1000);

    for (const t of await iVinduer(fra, til, (a, b) => hentTimesforbruk(token, l.chargerId, a, b))) {
      const finnes = await db
        .select({ id: easeeChargerHours.id })
        .from(easeeChargerHours)
        .where(and(eq(easeeChargerHours.orgId, orgId), eq(easeeChargerHours.chargerRowId, l.id), eq(easeeChargerHours.hourStart, t.start)))
        .limit(1);
      if (finnes[0]) {
        await db.update(easeeChargerHours).set({ kwh: t.kwh, fetchedAt: naa }).where(and(eq(easeeChargerHours.id, finnes[0].id), eq(easeeChargerHours.orgId, orgId)));
      } else if (t.kwh > 0) {
        // Nulltimer lagres ikke — de er de fleste, og de betyr ingenting for prisingen.
        await db.insert(easeeChargerHours).values({ id: randomUUID(), orgId, chargerRowId: l.id, hourStart: t.start, kwh: t.kwh, fetchedAt: naa });
      }
      timer++;
    }

    for (const o of await iVinduer(fra, til, (a, b) => hentOkterFraEasee(token, l.chargerId, a, b))) {
      const felter = {
        carConnected: new Date(o.carConnected!),
        carDisconnected: o.carDisconnected ? new Date(o.carDisconnected) : null,
        kwh: Number(o.kiloWattHours) || 0,
        isComplete: o.isComplete ?? Boolean(o.carDisconnected),
        fetchedAt: naa,
      };
      const finnes = await db
        .select({ id: easeeSessions.id })
        .from(easeeSessions)
        .where(and(eq(easeeSessions.orgId, orgId), eq(easeeSessions.chargerRowId, l.id), eq(easeeSessions.easeeSessionId, o.id)))
        .limit(1);
      if (finnes[0]) await db.update(easeeSessions).set(felter).where(and(eq(easeeSessions.id, finnes[0].id), eq(easeeSessions.orgId, orgId)));
      else await db.insert(easeeSessions).values({ id: randomUUID(), orgId, chargerRowId: l.id, easeeSessionId: o.id, ...felter });
      okter++;
    }
  }
  return { ladere: ladere.length, timer, okter };
}

/** Kaller `hent` for hvert vindu på `SYNK_VINDU_DAGER` i [fra, til) og slår svarene sammen. */
async function iVinduer<T>(fra: Date, til: Date, hent: (a: Date, b: Date) => Promise<T[]>): Promise<T[]> {
  const ut: T[] = [];
  const vindu = SYNK_VINDU_DAGER * 24 * 3600 * 1000;
  for (let a = fra.getTime(); a < til.getTime(); a += vindu) {
    ut.push(...(await hent(new Date(a), new Date(Math.min(a + vindu, til.getTime())))));
  }
  return ut;
}

/** Jobben: hele synken for én org — token, laderliste, tilstand, måned, timer, økter, spot. */
export async function synkEasee(db: Db, orgId: string, naa = new Date()) {
  const kobling = await hentRad(db, orgId);
  try {
    const r = await medToken(db, orgId, kobling, naa, async (token) => {
      await speilLadere(db, orgId, laderneI(await hentAnleggDetalj(token, kobling.siteId)));
      await friskOppTilstand(db, orgId, token, kobling.siteId, naa);
      await friskOppForbruk(db, orgId, token, naa);
      return synkTimerOgOkter(db, orgId, token, naa);
    });
    const spot = await synkSpotpriserFor(db, orgId, naa);
    await noterFeil(db, orgId, kobling.id, null, naa);
    return { ...r, spotdager: spot };
  } catch (e) {
    // Feilen skal synes på Integrasjoner-kortet, ikke bare i kjøringsloggen.
    await noterFeil(db, orgId, kobling.id, e instanceof Error ? e.message : String(e), naa);
    throw e;
  }
}

/** `?aar=2026&maaned=9` fra rapport-rutene. Bor her fordi en route.ts bare kan eksportere HTTP-metoder. */
export function lesMaaned(req: Request): { aar: number; maaned: number } {
  const u = new URL(req.url);
  const aar = Number(u.searchParams.get("aar"));
  const maaned = Number(u.searchParams.get("maaned"));
  if (!Number.isInteger(aar) || !Number.isInteger(maaned)) throw ugyldig("Oppgi aar og maaned");
  return { aar, maaned };
}

/** Prisområdene orgens spotplaner bruker. */
async function spotomraaderFor(db: Db, orgId: string): Promise<string[]> {
  const planer = await db
    .select({ priceArea: easeePricePlans.priceArea })
    .from(easeePricePlans)
    .where(and(eq(easeePricePlans.orgId, orgId), eq(easeePricePlans.kraftModel, "spot")));
  return [...new Set(planer.map((p) => p.priceArea).filter((a): a is string => Boolean(a)))];
}

/**
 * Spotpriser for orgens områder: dagene som mangler i `power_prices` fra
 * `SPOT_TILBAKEFYLL_DAGER` tilbake til i morgen (publiseres ~kl. 13). Tabellen er felles
 * for alle orger (ingen org-eier) — det som ligger der fra før, hentes ikke igjen.
 */
export async function synkSpotpriserFor(db: Db, orgId: string, naa = new Date()): Promise<number> {
  let dager = 0;
  for (const area of await spotomraaderFor(db, orgId)) dager += await synkSpotpriser(db, area, naa);
  return dager;
}

export async function synkSpotpriser(db: Db, area: string, naa = new Date()): Promise<number> {
  const fra = new Date(naa.getTime() - SPOT_TILBAKEFYLL_DAGER * 24 * 3600 * 1000);
  const har = new Set(
    (
      await db
        .select({ hourStart: powerPrices.hourStart })
        .from(powerPrices)
        .where(and(eq(powerPrices.area, area), gte(powerPrices.hourStart, fra)))
    ).map((r) => osloDato(r.hourStart)),
  );
  const dagerAaHente: string[] = [];
  for (let d = new Date(fra); d.getTime() <= naa.getTime() + 24 * 3600 * 1000; d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    const dato = osloDato(d);
    if (!har.has(dato) && !dagerAaHente.includes(dato)) dagerAaHente.push(dato);
  }
  let hentet = 0;
  for (const dato of dagerAaHente) {
    const timer = await hentSpotpriser(dato, area);
    if (timer.length === 0) continue;
    for (const t of timer) {
      const finnes = await db
        .select({ id: powerPrices.id })
        .from(powerPrices)
        .where(and(eq(powerPrices.area, area), eq(powerPrices.hourStart, t.hourStart)))
        .limit(1);
      if (!finnes[0]) await db.insert(powerPrices).values({ id: randomUUID(), area, hourStart: t.hourStart, nokPerKwh: t.nokPerKwh, fetchedAt: naa });
    }
    hentet++;
  }
  return hentet;
}

// ---------------------------------------------------------------------------------------
// Prisplaner
// ---------------------------------------------------------------------------------------

function planTilVisning(p: typeof easeePricePlans.$inferSelect) {
  return {
    id: p.id,
    validFrom: p.validFrom,
    name: p.name,
    kraftModel: p.kraftModel as Prisplan["kraftModel"],
    kraftOre: p.kraftOre,
    paaslagOre: p.paaslagOre,
    priceArea: (p.priceArea ?? null) as Prisplan["priceArea"],
    mvaProsent: p.mvaProsent,
    nettDagOre: p.nettDagOre,
    nettNattOre: p.nettNattOre,
    nattFra: p.nattFra,
    nattTil: p.nattTil,
    helgSomNatt: p.helgSomNatt,
    fastleddOre: p.fastleddOre,
    note: p.note,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
  };
}

export async function hentPrisplaner(db: Db, orgId: string) {
  const r = await db.select().from(easeePricePlans).where(eq(easeePricePlans.orgId, orgId)).orderBy(desc(easeePricePlans.validFrom));
  return r.map(planTilVisning);
}

function validerPlan(data: z.infer<typeof prisplanInn>) {
  if (data.kraftModel === "spot" && !data.priceArea) throw ugyldig("Spotpris krever et prisområde (NO1–NO5).");
  if (data.nattFra === data.nattTil) throw ugyldig("Natt fra og natt til kan ikke være samme time.");
}

/** Oppretter, eller endrer når `id` er satt. Én plan per gyldig-fra-dato. */
export async function lagrePrisplan(db: Db, orgId: string, av: Aktor, data: z.infer<typeof prisplanInn>, id?: string) {
  validerPlan(data);
  const kollisjon = await db
    .select({ id: easeePricePlans.id })
    .from(easeePricePlans)
    .where(and(eq(easeePricePlans.orgId, orgId), eq(easeePricePlans.validFrom, data.validFrom), ...(id ? [ne(easeePricePlans.id, id)] : [])))
    .limit(1);
  if (kollisjon[0]) throw ugyldig(`Det finnes allerede en prisplan som gjelder fra ${data.validFrom}.`);
  const felter = {
    validFrom: data.validFrom,
    name: data.name,
    kraftModel: data.kraftModel,
    kraftOre: data.kraftModel === "norgespris" ? data.kraftOre : 0,
    paaslagOre: data.kraftModel === "spot" ? data.paaslagOre : 0,
    priceArea: data.kraftModel === "spot" ? data.priceArea ?? null : null,
    mvaProsent: data.mvaProsent,
    nettDagOre: data.nettDagOre,
    nettNattOre: data.nettNattOre,
    nattFra: data.nattFra,
    nattTil: data.nattTil,
    helgSomNatt: data.helgSomNatt,
    fastleddOre: data.fastleddOre,
    note: data.note ?? null,
  };
  let planId = id;
  if (id) {
    const r = await db.update(easeePricePlans).set(felter).where(and(eq(easeePricePlans.id, id), eq(easeePricePlans.orgId, orgId))).returning({ id: easeePricePlans.id });
    if (!r[0]) throw ikkeFunnet("Prisplan");
  } else {
    planId = randomUUID();
    await db.insert(easeePricePlans).values({ id: planId, orgId, ...felter, createdBy: av.navn, createdByUserId: av.brukerId });
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "easee_prisplan", entitetId: planId!,
    hendelse: `${id ? "Endret" : "Opprettet"} prisplanen «${data.name}» for lading fra ${data.validFrom}: ${beskrivPlan(felter)}`,
  });
  return hentPrisplaner(db, orgId);
}

function beskrivPlan(p: { kraftModel: string; kraftOre: number; paaslagOre: number; priceArea: string | null; nettDagOre: number; nettNattOre: number; fastleddOre: number }) {
  const kraft = p.kraftModel === "norgespris" ? `Norgespris ${tilKronerTekst(p.kraftOre)} kr/kWh` : `spot ${p.priceArea} + ${tilKronerTekst(p.paaslagOre)} kr/kWh`;
  return `${kraft}, nettleie dag ${tilKronerTekst(p.nettDagOre)} / natt ${tilKronerTekst(p.nettNattOre)} kr/kWh, fastledd ${tilKronerTekst(p.fastleddOre)} kr/mnd`;
}

export async function slettPrisplan(db: Db, orgId: string, av: Aktor, id: string) {
  const r = await db.delete(easeePricePlans).where(and(eq(easeePricePlans.id, id), eq(easeePricePlans.orgId, orgId))).returning({ name: easeePricePlans.name, validFrom: easeePricePlans.validFrom });
  if (!r[0]) throw ikkeFunnet("Prisplan");
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "easee_prisplan", entitetId: id,
    hendelse: `Slettet prisplanen «${r[0].name}» for lading (gjaldt fra ${r[0].validFrom})`,
  });
}

// ---------------------------------------------------------------------------------------
// Rapporten — én måned, per lader/plass/seksjon
// ---------------------------------------------------------------------------------------

export type Rapportlinje = {
  laderId: string;
  laderNavn: string;
  chargerId: string;
  aktiv: boolean;
  plass: { id: string; number: string; holderName: string | null; unitLabel: string | null } | null;
  seksjon: { id: string; navn: string } | null;
  eier: { id: string; name: string; email: string | null } | null;
  avtale: { tenantName: string; powerBilling: string | null } | null;
  okter: number;
  kwhDag: number;
  kwhNatt: number;
  kwh: number;
  kraftOre: number;
  nettOre: number;
  fastleddOre: number;
  sumOre: number;
  timerUtenPris: number;
  kwhUtenPris: number;
};

/**
 * Rapporten for én måned: timene i måneden (Oslo) per lader, priset etter planen som
 * gjaldt, med fastledd per lader som står på en plass. Uten plan kommer kWh, men ingen
 * kroner. Spottimer uten pris telles og varsles — de er ikke stille 0.
 */
export async function hentRapport(db: Db, orgId: string, aar: number, maaned: number) {
  if (maaned < 1 || maaned > 12 || aar < 2020 || aar > 2100) throw ugyldig("Ugyldig måned");
  const planer = await hentPrisplaner(db, orgId);
  const plan = gjeldendePlan(planer, aar, maaned);
  const { fra, til } = maanedsgrenser(aar, maaned);

  const ladere = await db.select().from(easeeChargers).where(eq(easeeChargers.orgId, orgId)).orderBy(asc(easeeChargers.name));
  const timer = await db
    .select({ chargerRowId: easeeChargerHours.chargerRowId, hourStart: easeeChargerHours.hourStart, kwh: easeeChargerHours.kwh })
    .from(easeeChargerHours)
    .where(and(eq(easeeChargerHours.orgId, orgId), gte(easeeChargerHours.hourStart, fra), lt(easeeChargerHours.hourStart, til)));
  const okter = await db
    .select({ chargerRowId: easeeSessions.chargerRowId })
    .from(easeeSessions)
    .where(and(eq(easeeSessions.orgId, orgId), gte(easeeSessions.carConnected, fra), lt(easeeSessions.carConnected, til)));
  const spot = new Map<number, number>();
  if (plan?.kraftModel === "spot" && plan.priceArea) {
    const priser = await db
      .select({ hourStart: powerPrices.hourStart, nokPerKwh: powerPrices.nokPerKwh })
      .from(powerPrices)
      .where(and(eq(powerPrices.area, plan.priceArea), gte(powerPrices.hourStart, fra), lt(powerPrices.hourStart, til)));
    for (const p of priser) spot.set(p.hourStart.getTime(), p.nokPerKwh);
  }

  const plassIder = ladere.map((l) => l.spotId).filter((x): x is string => Boolean(x));
  const plasser = plassIder.length
    ? await db.select().from(parkingSpots).where(and(eq(parkingSpots.orgId, orgId), inArray(parkingSpots.id, plassIder)))
    : [];
  const avtaler = plassIder.length
    ? await db
        .select({ spotId: parkingLeases.spotId, tenantName: parkingLeases.tenantName, powerBilling: parkingLeases.powerBilling })
        .from(parkingLeases)
        .where(and(eq(parkingLeases.orgId, orgId), inArray(parkingLeases.spotId, plassIder), isNull(parkingLeases.endedAt)))
    : [];
  const enhetIder = plasser.map((p) => p.unitId).filter((x): x is string => Boolean(x));
  const enheter = enhetIder.length ? await db.select().from(units).where(and(eq(units.orgId, orgId), inArray(units.id, enhetIder))) : [];
  const eiere = enhetIder.length
    ? await db.select().from(unitOwners).where(and(eq(unitOwners.orgId, orgId), inArray(unitOwners.unitId, enhetIder), isNull(unitOwners.ownerTo)))
    : [];

  const timerPer = new Map<string, Array<{ start: Date; kwh: number }>>();
  for (const t of timer) (timerPer.get(t.chargerRowId) ?? timerPer.set(t.chargerRowId, []).get(t.chargerRowId)!).push({ start: t.hourStart, kwh: t.kwh });
  const okterPer = new Map<string, number>();
  for (const o of okter) okterPer.set(o.chargerRowId, (okterPer.get(o.chargerRowId) ?? 0) + 1);

  const linjer: Rapportlinje[] = [];
  for (const l of ladere) {
    const mine = timerPer.get(l.id) ?? [];
    const plass = l.spotId ? plasser.find((p) => p.id === l.spotId) ?? null : null;
    if (mine.length === 0 && !plass) continue; // ukoblet lader uten forbruk — ingenting å rapportere
    const k = plan ? beregnKostnad(plan, mine) : null;
    const kostnad = plan?.kraftModel === "spot" ? beregnKostnad(plan, mine, spot) : k;
    const enhet = plass?.unitId ? enheter.find((u) => u.id === plass.unitId) ?? null : null;
    const eier = enhet ? eiere.find((e) => e.unitId === enhet.id) ?? null : null;
    const a = plass ? avtaler.find((x) => x.spotId === plass.id) ?? null : null;
    const avtale = a ? { tenantName: a.tenantName, powerBilling: a.powerBilling } : null;
    const fastledd = plan && plass && l.active ? plan.fastleddOre : 0;
    const kwh = mine.reduce((n, t) => n + t.kwh, 0);
    linjer.push({
      laderId: l.id,
      laderNavn: l.name,
      chargerId: l.chargerId,
      aktiv: l.active,
      plass: plass ? { id: plass.id, number: plass.number, holderName: plass.holderName, unitLabel: plass.unitLabel } : null,
      seksjon: enhet ? { id: enhet.id, navn: enhet.leilighetsnr ?? enhet.navn ?? enhet.andelsnr ?? enhet.id } : null,
      eier: eier ? { id: eier.id, name: eier.name, email: eier.email } : null,
      avtale,
      okter: okterPer.get(l.id) ?? 0,
      kwhDag: kostnad?.kwhDag ?? 0,
      kwhNatt: kostnad?.kwhNatt ?? 0,
      kwh,
      kraftOre: kostnad?.kraftOre ?? 0,
      nettOre: kostnad?.nettOre ?? 0,
      fastleddOre: fastledd,
      sumOre: (kostnad?.kraftOre ?? 0) + (kostnad?.nettOre ?? 0) + fastledd,
      timerUtenPris: kostnad?.timerUtenPris ?? 0,
      kwhUtenPris: kostnad?.kwhUtenPris ?? 0,
    });
  }
  linjer.sort((a, b) => (a.plass?.number ?? "~").localeCompare(b.plass?.number ?? "~", "nb", { numeric: true }));

  const advarsler: string[] = [];
  if (!plan) advarsler.push("Ingen prisplan gjelder for måneden — bare kWh vises. Lag en prisplan under «Priser».");
  const utenPris = linjer.reduce((n, l) => n + l.timerUtenPris, 0);
  if (utenPris > 0) advarsler.push(`${utenPris} timer med forbruk mangler spotpris (${linjer.reduce((n, l) => n + l.kwhUtenPris, 0).toFixed(1)} kWh) — kraften for dem er ikke med i summen. Prøv «Oppdater fra Easee».`);
  const utenSeksjon = linjer.filter((l) => l.plass && !l.seksjon).length;
  if (utenSeksjon > 0) advarsler.push(`${utenSeksjon} plass${utenSeksjon === 1 ? "" : "er"} med lader mangler kobling til seksjon — sett «Seksjon» på plassen for at forbruket skal kunne faktureres eieren.`);
  const utenPlass = linjer.filter((l) => !l.plass && l.kwh > 0).length;
  if (utenPlass > 0) advarsler.push(`${utenPlass} lader${utenPlass === 1 ? "" : "e"} med forbruk er ikke koblet til plass.`);

  const sum = linjer.reduce(
    (s, l) => ({ kwh: s.kwh + l.kwh, kwhDag: s.kwhDag + l.kwhDag, kwhNatt: s.kwhNatt + l.kwhNatt, kraftOre: s.kraftOre + l.kraftOre, nettOre: s.nettOre + l.nettOre, fastleddOre: s.fastleddOre + l.fastleddOre, sumOre: s.sumOre + l.sumOre }),
    { kwh: 0, kwhDag: 0, kwhNatt: 0, kraftOre: 0, nettOre: 0, fastleddOre: 0, sumOre: 0 },
  );
  return { aar, maaned, plan, linjer, sum, advarsler, spotTimer: spot.size };
}

/** Øktene for én lader i måneden — «hvem ladet når», til skuffen i rapporten. */
export async function hentOkter(db: Db, orgId: string, laderId: string, aar: number, maaned: number) {
  const { fra, til } = maanedsgrenser(aar, maaned);
  const r = await db
    .select()
    .from(easeeSessions)
    .where(and(eq(easeeSessions.orgId, orgId), eq(easeeSessions.chargerRowId, laderId), gte(easeeSessions.carConnected, fra), lt(easeeSessions.carConnected, til)))
    .orderBy(desc(easeeSessions.carConnected));
  return r.map((o) => ({ id: o.id, carConnected: o.carConnected, carDisconnected: o.carDisconnected, kwh: o.kwh, isComplete: o.isComplete }));
}

/** CSV av rapporten — til forretningsfører eller regneark. Eksport logges. */
export async function eksporterRapport(db: Db, orgId: string, aar: number, maaned: number, av: Aktor) {
  const r = await hentRapport(db, orgId, aar, maaned);
  const rader: Array<Array<string | number | null>> = [
    ["Plass", "Seksjon", "Eier", "E-post", "Lader", "Økter", "kWh dag", "kWh natt", "kWh totalt", "Kraft", "Nettleie", "Fastledd", "Sum"],
  ];
  for (const l of r.linjer) {
    rader.push([
      l.plass?.number ?? null, l.seksjon?.navn ?? l.plass?.unitLabel ?? null, l.eier?.name ?? l.avtale?.tenantName ?? l.plass?.holderName ?? null, l.eier?.email ?? null,
      `${l.laderNavn} (${l.chargerId})`, l.okter, l.kwhDag.toFixed(2).replace(".", ","), l.kwhNatt.toFixed(2).replace(".", ","), l.kwh.toFixed(2).replace(".", ","),
      tilKronerTekst(l.kraftOre), tilKronerTekst(l.nettOre), tilKronerTekst(l.fastleddOre), tilKronerTekst(l.sumOre),
    ]);
  }
  const mm = String(maaned).padStart(2, "0");
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "easee_rapport", entitetId: null,
    hendelse: `Eksporterte laderapporten for ${aar}-${mm} (CSV, ${r.linjer.length} linjer)`,
  });
  return {
    innhold: new TextEncoder().encode(tilCsv(rader)),
    navn: `lading-${aar}-${mm}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}
