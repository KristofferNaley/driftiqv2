/**
 * Regnskapskoblingen per org — steg 2 i `docs/fiken.md`: koble til, speile kjøp, gi
 * «faktisk» til budsjettet. Skriver aldri til Fiken.
 *
 * Tokens ligger kryptert i `fiken_connections` (`lib/kryptering.ts`) og dekrypteres bare
 * her, i det øyeblikket et kall skal gjøres. `hentKobling()` returnerer aldri tokenet.
 *
 * ## To måter å koble på
 *
 * - **OAuth** (produktet): `startOAuth` → Fiken → `fullforOAuth` med signert `state`.
 * - **API-nøkkel** (KUN testmiljøet, `ER_TESTMILJO`): personlig nøkkel mot demoforetaket,
 *   så koblingen kan prøves uten OAuth-app. Fikens vilkår forbyr personlig nøkkel i en
 *   tredjepartsapp; ruta svarer 404 i prod, og `authMode` sier hva raden er.
 */

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { fikenConnections, fikenPurchases } from "../db/schema/okonomi";
import { vendors } from "../db/schema/vendors";
import type { Aktor } from "./aktor";
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import {
  FikenFeil,
  autoriseringsUrl,
  hentForetak,
  hentKjop,
  hentToken,
  lagState,
  lesLinjer,
  lesState,
  oauthErKonfigurert,
  tilLokaltKjop,
} from "./fiken";
import { loggHendelse } from "./hendelser";
import { dekrypter, krypter, krypteringErKonfigurert } from "./kryptering";
import { ER_TESTMILJO } from "./miljo";
import { isoDato, kontoIIntervall } from "./okonomiregler";
import { normaliserOrgnr } from "./orgnr";

const MODUL = "okonomi" as const;

export const nokkelInn = z.object({
  apiKey: z.string().trim().min(10, "Nøkkelen ser for kort ut"),
  /** Foretaket nøkkelen skal brukes mot. Velges fra `GET /companies` hvis den utelates og bare ett finnes. */
  slug: z.string().trim().nullish(),
});

/** Status uten hemmeligheter — det Integrasjon-fanen viser. */
export async function hentKobling(db: Db, orgId: string) {
  const r = await db
    .select()
    .from(fikenConnections)
    .where(eq(fikenConnections.orgId, orgId))
    .limit(1);
  const k = r[0];
  const [antall] = await db
    .select({ n: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(${fikenPurchases.gross}), 0)::bigint` })
    .from(fikenPurchases)
    .where(and(eq(fikenPurchases.orgId, orgId), eq(fikenPurchases.deleted, false)));
  return {
    konfigurert: { kryptering: krypteringErKonfigurert(), oauth: oauthErKonfigurert(), apiNokkel: ER_TESTMILJO && krypteringErKonfigurert() },
    kobling: k
      ? {
          companySlug: k.companySlug,
          companyName: k.companyName,
          companyOrgNumber: k.companyOrgNumber,
          vatType: k.vatType,
          authMode: k.authMode,
          connectedBy: k.connectedBy,
          createdAt: k.createdAt,
          lastSyncAt: k.lastSyncAt,
          lastSyncError: k.lastSyncError,
        }
      : null,
    kjop: { antall: antall?.n ?? 0, sum: Number(antall?.sum ?? 0) },
  };
}

async function hentRad(db: Db, orgId: string) {
  const r = await db.select().from(fikenConnections).where(eq(fikenConnections.orgId, orgId)).limit(1);
  if (!r[0]) throw ikkeFunnet("Fiken-kobling");
  return r[0];
}

/** Gyldig token — fornyet via refresh-token når det er i ferd med å gå ut. */
async function gyldigToken(db: Db, orgId: string): Promise<string> {
  const k = await hentRad(db, orgId);
  if (k.authMode === "api_key") return dekrypter(k.accessTokenEnc);
  const snartUte = k.tokenExpiresAt && k.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!snartUte) return dekrypter(k.accessTokenEnc);
  if (!k.refreshTokenEnc) throw new FikenFeil(401, "Tokenet er utløpt og kan ikke fornyes — koble til på nytt");
  const t = await hentToken({ grant_type: "refresh_token", refresh_token: dekrypter(k.refreshTokenEnc) });
  await db
    .update(fikenConnections)
    .set({
      accessTokenEnc: krypter(t.access_token),
      refreshTokenEnc: t.refresh_token ? krypter(t.refresh_token) : k.refreshTokenEnc,
      tokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    })
    .where(and(eq(fikenConnections.id, k.id), eq(fikenConnections.orgId, orgId)));
  return t.access_token;
}

async function lagreKobling(
  db: Db,
  orgId: string,
  av: Aktor,
  d: { token: string; refresh?: string | null; utloper?: Date | null; authMode: "oauth" | "api_key"; slug?: string | null },
) {
  const foretak = await hentForetak(d.token);
  if (foretak.length === 0) throw ugyldig("Nøkkelen har ikke tilgang til noe foretak i Fiken.");
  const valgt = d.slug ? foretak.find((f) => f.slug === d.slug) : foretak.length === 1 ? foretak[0] : null;
  if (!valgt) {
    throw ugyldig(
      `Velg hvilket foretak som skal kobles: ${foretak.map((f) => `${f.name} (${f.slug})`).join(", ")}`,
    );
  }

  const felter = {
    companySlug: valgt.slug,
    companyName: valgt.name,
    companyOrgNumber: valgt.organizationNumber ?? null,
    vatType: valgt.vatType ?? null,
    authMode: d.authMode,
    accessTokenEnc: krypter(d.token),
    refreshTokenEnc: d.refresh ? krypter(d.refresh) : null,
    tokenExpiresAt: d.utloper ?? null,
    connectedBy: av.navn,
    connectedByUserId: av.brukerId,
    lastSyncAt: null,
    lastSyncError: null,
  };
  const finnes = await db.select({ id: fikenConnections.id }).from(fikenConnections).where(eq(fikenConnections.orgId, orgId)).limit(1);
  if (finnes[0]) {
    await db.update(fikenConnections).set(felter).where(and(eq(fikenConnections.id, finnes[0].id), eq(fikenConnections.orgId, orgId)));
  } else {
    await db.insert(fikenConnections).values({ id: randomUUID(), orgId, ...felter });
  }
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "fiken", entitetId: null,
    hendelse: `Koblet regnskapet til Fiken-foretaket «${valgt.name}» (${d.authMode === "oauth" ? "OAuth" : "API-nøkkel, testmiljø"})`,
  });
  return hentKobling(db, orgId);
}

/** Testmiljøet: personlig nøkkel mot demoforetaket. 404 i prod — ruta finnes ikke der. */
export async function kobleTilMedNokkel(db: Db, orgId: string, av: Aktor, data: z.infer<typeof nokkelInn>) {
  if (!ER_TESTMILJO) throw ikkeFunnet("Siden");
  return lagreKobling(db, orgId, av, { token: data.apiKey, authMode: "api_key", slug: data.slug });
}

export function startOAuth(orgId: string, redirectUri: string): string {
  if (!oauthErKonfigurert()) throw new ApiFeil(503, "OAuth mot Fiken er ikke satt opp (FIKEN_CLIENT_ID/SECRET).");
  return autoriseringsUrl(redirectUri, lagState(orgId));
}

/** Callbacken: `state` verifiseres FØR koden byttes — en callback skal aldri lande i feil org. */
export function orgFraState(state: string): string {
  const s = lesState(state);
  if (!s) throw ugyldig("Ugyldig eller utløpt state fra Fiken");
  return s.orgId;
}

export async function fullforOAuth(db: Db, orgId: string, av: Aktor, code: string, redirectUri: string) {
  const t = await hentToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  return lagreKobling(db, orgId, av, {
    token: t.access_token,
    refresh: t.refresh_token ?? null,
    utloper: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    authMode: "oauth",
  });
}

/** Frakobling sletter speilet (kundens regnskap skal ikke ligge igjen) og logges. */
export async function kobleFra(db: Db, orgId: string, av: Aktor) {
  const k = await hentRad(db, orgId);
  await db.delete(fikenPurchases).where(eq(fikenPurchases.orgId, orgId));
  await db.delete(fikenConnections).where(and(eq(fikenConnections.id, k.id), eq(fikenConnections.orgId, orgId)));
  await loggHendelse(db, orgId, av, {
    modul: MODUL, entitet: "fiken", entitetId: null,
    hendelse: `Koblet regnskapet fra Fiken-foretaket «${k.companyName}»; speilede kjøp slettet`,
  });
}

export type Synkresultat =
  | { ok: true; nye: number; oppdaterte: number; hentet: number }
  | { ok: false; feil: string };

/**
 * Speiler kjøpene. Første synk henter alt; senere synk henter «siden i går» (Fikens
 * `lastModifiedGe` er en dato) og oppdaterer på (org, fikenId).
 *
 * Feil RETURNERES, kastes ikke: kallet står i en transaksjon (`withOrg`), og et kast ville
 * rullet tilbake `lastSyncError` sammen med alt annet — da hadde Integrasjon-fanen aldri
 * fått vite hvorfor synken stoppet.
 */
export async function synkKjop(db: Db, orgId: string, naa = new Date()): Promise<Synkresultat> {
  const k = await hentRad(db, orgId);
  try {
    const token = await gyldigToken(db, orgId);
    const siden = k.lastSyncAt ? isoDato(new Date(k.lastSyncAt.getTime() - 24 * 60 * 60 * 1000)) : undefined;
    const kjop = await hentKjop(token, k.companySlug, siden);
    let nye = 0;
    let oppdaterte = 0;
    for (const fk of kjop) {
      if (fk.kind !== "supplier" && fk.kind !== "cash_purchase") continue;
      const lokalt = tilLokaltKjop(fk);
      const finnes = await db
        .select({ id: fikenPurchases.id })
        .from(fikenPurchases)
        .where(and(eq(fikenPurchases.orgId, orgId), eq(fikenPurchases.fikenId, lokalt.fikenId)))
        .limit(1);
      if (finnes[0]) {
        await db.update(fikenPurchases).set({ ...lokalt, syncedAt: naa }).where(and(eq(fikenPurchases.id, finnes[0].id), eq(fikenPurchases.orgId, orgId)));
        oppdaterte++;
      } else {
        await db.insert(fikenPurchases).values({ id: randomUUID(), orgId, ...lokalt, syncedAt: naa });
        nye++;
      }
    }
    await oppdaterSistBrukt(db, orgId);
    await db
      .update(fikenConnections)
      .set({ lastSyncAt: naa, lastSyncError: null })
      .where(and(eq(fikenConnections.id, k.id), eq(fikenConnections.orgId, orgId)));
    return { ok: true, nye, oppdaterte, hentet: kjop.length };
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e);
    await db
      .update(fikenConnections)
      .set({ lastSyncError: melding.slice(0, 500) })
      .where(and(eq(fikenConnections.id, k.id), eq(fikenConnections.orgId, orgId)));
    return { ok: false, feil: melding };
  }
}

/**
 * Kjøpene som hører til én leverandør i registeret: på normalisert orgnr når begge har det,
 * ellers på navn (uten store/små bokstaver). Samme grep som partnerregisteret i
 * leverandørportal-notatet — matching ved lesing, ingenting lagres.
 */
export function kjopTilhorer(
  leverandor: { name: string; orgNumber: string | null },
  kjop: { supplierName: string | null; supplierOrgNumber: string | null },
): "orgnr" | "navn" | null {
  const a = normaliserOrgnr(leverandor.orgNumber);
  const b = normaliserOrgnr(kjop.supplierOrgNumber);
  if (a && b) return a === b ? "orgnr" : null;
  if (kjop.supplierName && kjop.supplierName.trim().toLowerCase() === leverandor.name.trim().toLowerCase()) return "navn";
  return null;
}

/** Leverandørkortet: kjøpene fra Fiken for én leverandør, med sum per år. */
export async function kjopForLeverandor(db: Db, orgId: string, vendorId: string) {
  const lev = await db
    .select({ id: vendors.id, name: vendors.name, orgNumber: vendors.orgNumber })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.orgId, orgId)))
    .limit(1);
  if (!lev[0]) throw ikkeFunnet("Leverandør");
  const koblet = (await db.select({ id: fikenConnections.id }).from(fikenConnections).where(eq(fikenConnections.orgId, orgId)).limit(1)).length > 0;
  const alle = await hentKjopLokalt(db, orgId, { grense: 5000 });
  const kjop = alle
    .map((k) => ({ ...k, treff: kjopTilhorer(lev[0]!, k) }))
    .filter((k) => k.treff !== null);
  const perAar = new Map<number, { aar: number; antall: number; sum: number }>();
  for (const k of kjop) {
    const aar = Number(k.date.slice(0, 4));
    const r = perAar.get(aar) ?? { aar, antall: 0, sum: 0 };
    r.antall++;
    r.sum += k.gross;
    perAar.set(aar, r);
  }
  return {
    koblet,
    kjop: kjop.map(({ treff: _treff, ...k }) => k),
    treffPaa: kjop[0]?.treff ?? null,
    perAar: [...perAar.values()].sort((a, b) => b.aar - a.aar),
    sisteKjop: kjop[0]?.date ?? null,
  };
}

/**
 * «Sist brukt» på handelskontoer fylles fra bokførte kjøp i stedet for for hånd — det var
 * verdien notatet lovet leverandørkortet. Bare framover: en manuelt satt nyere dato røres ikke.
 */
async function oppdaterSistBrukt(db: Db, orgId: string) {
  const [levs, kjop] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name, orgNumber: vendors.orgNumber, lastUsedAt: vendors.lastUsedAt }).from(vendors).where(eq(vendors.orgId, orgId)),
    hentKjopLokalt(db, orgId, { grense: 5000 }),
  ]);
  for (const lev of levs) {
    let siste: string | null = null;
    for (const k of kjop) {
      if (kjopTilhorer(lev, k) && (!siste || k.date > siste)) siste = k.date;
    }
    if (siste && (!lev.lastUsedAt || siste > lev.lastUsedAt)) {
      await db.update(vendors).set({ lastUsedAt: siste }).where(and(eq(vendors.id, lev.id), eq(vendors.orgId, orgId)));
    }
  }
}

/** Speilede kjøp, nyeste først — til lista på Integrasjon-fanen og leverandørkortet. */
export async function hentKjopLokalt(db: Db, orgId: string, opts: { aar?: number; grense?: number } = {}) {
  const betingelser = [eq(fikenPurchases.orgId, orgId), eq(fikenPurchases.deleted, false)];
  if (opts.aar) {
    betingelser.push(gte(fikenPurchases.date, `${opts.aar}-01-01`), lte(fikenPurchases.date, `${opts.aar}-12-31`));
  }
  const rader = await db
    .select()
    .from(fikenPurchases)
    .where(and(...betingelser))
    .orderBy(desc(fikenPurchases.date), asc(fikenPurchases.identifier))
    .limit(opts.grense ?? 200);
  return rader.map((r) => ({ ...r, linjer: lesLinjer(r.lines) }));
}

/**
 * «Faktisk» per budsjettlinje fra Fiken: summen av kjøpslinjer i budsjettåret hvis konto
 * ligger i linjas intervall. Brutto — det sameiet betaler. `null` uten kobling, så
 * kallstedet kan falle tilbake til godkjente fakturaer.
 */
export async function faktiskFraFiken(
  db: Db,
  orgId: string,
  aar: number,
  linjer: ReadonlyArray<{ id: string; accountFrom: number | null; accountTo: number | null }>,
): Promise<Map<string, number> | null> {
  const k = await db.select({ id: fikenConnections.id }).from(fikenConnections).where(eq(fikenConnections.orgId, orgId)).limit(1);
  if (!k[0]) return null;
  const kjop = await hentKjopLokalt(db, orgId, { aar, grense: 5000 });
  const sum = new Map<string, number>();
  for (const l of linjer) sum.set(l.id, 0);
  for (const kj of kjop) {
    for (const linje of kj.linjer) {
      for (const bl of linjer) {
        if (kontoIIntervall(linje.account, bl.accountFrom, bl.accountTo)) {
          sum.set(bl.id, (sum.get(bl.id) ?? 0) + linje.gross);
        }
      }
    }
  }
  return sum;
}
