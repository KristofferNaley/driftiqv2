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

import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { easeeChargerUsage, easeeChargers, easeeSettings } from "../db/schema/easee";
import { parkingLeases, parkingSpots } from "../db/schema/parking";
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
  hentProfil,
  laderneI,
  loggInn,
  tilstandeneI,
} from "./easee";
import { loggHendelse } from "./hendelser";
import { dekrypter, krypter, krypteringErKonfigurert } from "./kryptering";

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

export const prisInn = z.object({
  /** Øre per kWh. null = bare kWh vises i avregningen. */
  pricePerKwhOre: z.number().int().min(0).max(100_000).nullable(),
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
          pricePerKwhOre: k.pricePerKwhOre,
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

export async function settPris(db: Db, orgId: string, av: Aktor, data: z.infer<typeof prisInn>) {
  const k = await hentRad(db, orgId);
  await db
    .update(easeeSettings)
    .set({ pricePerKwhOre: data.pricePerKwhOre })
    .where(and(eq(easeeSettings.id, k.id), eq(easeeSettings.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "easee", entitetId: null,
    hendelse: data.pricePerKwhOre === null
      ? "Fjernet strømprisen for ladeavregningen"
      : `Satte strømprisen for ladeavregningen til ${(data.pricePerKwhOre / 100).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/kWh`,
  });
  return hentKobling(db, orgId);
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
        });
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
    anlegg: kobling ? { siteName: kobling.siteName, pricePerKwhOre: kobling.pricePerKwhOre } : null,
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
