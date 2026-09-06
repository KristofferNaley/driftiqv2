/**
 * Easee — ladeanlegget i parkeringsmodulen. Ingen v1-forgjenger; bygget fra Easees
 * API-dokumentasjon (developer.easee.com), se docs/easee.md.
 *
 * Tyngdepunktet: (1) hvitelista er lukket og KUN lesing (pluss innlogging og
 * tokenfornying) — DriftIQ starter, stopper eller styrer aldri en lader; (2) passordet
 * lagres aldri, tokenene ligger kryptert og lekker aldri ut av status- eller
 * lading-svaret, og de fornyes før utløp og ved 401; (3) laderne speiles fra anlegget,
 * tilstanden hentes i ETT kall og forbruket lagres per måned, så avregningen kan gjøres
 * igjen uten Easee; (4) én lader per plass, og plassen får `hasCharger`; (5) svikter
 * Easee, kommer fanen likevel med sist kjente tall og `feil` satt; (6) org A ser aldri
 * org Bs kobling eller ladere.
 *
 * Nettet er stubbet (`fetch`) — testene går aldri mot api.easee.com.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import type { Aktor } from "../src/lib/aktor";
import { TILLATTE_KALL, easeeKall, erTillatt, laderneI, opModeTekst, tilstandeneI } from "../src/lib/easee";
import {
  FORBRUK_HOLDBARHET_MS,
  TILSTAND_HOLDBARHET_MS,
  TOKEN_MARGIN_MS,
  eksporterRapport,
  forbrukFra,
  forbrukTil,
  hentKobling,
  hentLading,
  hentOkter,
  hentPrisplaner,
  hentRapport,
  kobleFra,
  kobleLaderTilPlass,
  kobleTil,
  lagrePrisplan,
  slettPrisplan,
  synkEasee,
} from "../src/lib/easeekobling";
import { type Prisplan, beregnKostnad, erNatt, gjeldendePlan, maanedsgrenser, prisForTime, spotTilOre } from "../src/lib/laderegler";
import { opprettPlass } from "../src/lib/parkering";
import { hentSpotpriser } from "../src/lib/spotpris";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const kari: Aktor = { navn: "Kari Styreleder", brukerId: null };

const KONTO = { userName: "styret@ladelaget.no", password: "hemmelig-passord" };
const TOKEN_1 = "access-token-1";
const REFRESH_1 = "refresh-token-1";
const SITE = 4711;
const LADER_A = "EH000AAA";
const LADER_B = "EH000BBB";

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
  process.env.FIKEN_TOKEN_KEY ??= "ab".repeat(32);
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

beforeEach(() => vi.unstubAllGlobals());

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM easee_charger_usage WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM easee_charger_hours WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM easee_sessions WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM easee_price_plans WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM easee_chargers WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM easee_settings WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM parking_leases WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM parking_spots WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM unit_owners WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM units WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  // Spotprisene er felles (ingen org) — testene bruker et eget, fiktivt område.
  await eier.query("DELETE FROM power_prices WHERE area = 'NO9'");
});

async function oppsett() {
  const orgId = `eas-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [orgId, "Ladelaget", orgId]);
  ryddOrg.push(orgId);
  const unitId = randomUUID();
  await eier.query("INSERT INTO units (id, org_id, type, leilighetsnr, oppgang) VALUES ($1,$2,'bolig','H0101','A')", [unitId, orgId]);
  await eier.query("INSERT INTO unit_owners (id, org_id, unit_id, name, email, owner_from) VALUES ($1,$2,$3,'Ola Beboer','ola@example.org','2020-01-01')", [randomUUID(), orgId, unitId]);
  const p1 = randomUUID();
  const p2 = randomUUID();
  await eier.query("INSERT INTO parking_spots (id, org_id, number, holder_name, unit_label, unit_id, has_charger) VALUES ($1,$2,'P01','Ola Beboer','H0101',$3,false)", [p1, orgId, unitId]);
  await eier.query("INSERT INTO parking_spots (id, org_id, number, has_charger, status) VALUES ($1,$2,'P02',true,'utleid')", [p2, orgId]);
  await eier.query(
    "INSERT INTO parking_leases (id, org_id, spot_id, tenant_name, price_per_month, power_billing) VALUES ($1,$2,$3,'Leif Leietaker',900,'forbruk')",
    [randomUUID(), orgId, p2],
  );
  return { orgId, p1, p2, unitId };
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    return e as ApiFeil;
  }
  throw new Error("Forventet en feil, men kallet gikk gjennom");
}

type Stubbvalg = {
  /** Anleggene nøkkelen når. */
  anlegg?: Array<{ id: number; name: string }>;
  /** Laderne i anlegget (per kurs «Garasje»). */
  ladere?: Array<{ id: string; name: string }>;
  /** Tilstand per lader-id. */
  tilstand?: Record<string, { chargerOpMode: number; isOnline: boolean; totalPower?: number; sessionEnergy?: number; lifetimeEnergy?: number }>;
  /** Månedsforbruk per lader-id. */
  forbruk?: Record<string, Array<{ year: number; month: number; consumption: number }>>;
  /** Svar 500 på state-kallet. */
  tilstandFeiler?: boolean;
  /** Access tokens Easee godtar akkurat nå (utløpte/ugyldiggjorte er borte fra lista). */
  gyldigeTokens?: string[];
  /** Svar 401 på fornying (refresh token er dødt). */
  fornyingFeiler?: boolean;
  /** Timesforbruk per lader-id: [ISO-time, kWh]. */
  timer?: Record<string, Array<[string, number]>>;
  /** Ladeøkter per lader-id. */
  okter?: Record<string, Array<{ id: number; carConnected: string; carDisconnected: string | null; kiloWattHours: number }>>;
  /** Spotpris (NOK/kWh uten mva) per ISO-time for området NO9. */
  spot?: Record<string, number>;
};

/** Stubber Easee: profil, anlegg, anleggsdetalj, tilstand og månedsforbruk. */
function stubbEasee(valg: Stubbvalg = {}) {
  const kall: Array<{ metode: string; sti: string; auth: string | undefined; kropp?: unknown }> = [];
  const gyldige = new Set(valg.gyldigeTokens ?? [TOKEN_1]);
  let fornyet = 0;
  const anlegg = valg.anlegg ?? [{ id: SITE, name: "Sameiet Ladebakken" }];
  const ladere = valg.ladere ?? [{ id: LADER_B, name: "Plass 2" }, { id: LADER_A, name: "Plass 1" }];
  const tilstand = valg.tilstand ?? {
    [LADER_A]: { chargerOpMode: 3, isOnline: true, totalPower: 7.2, sessionEnergy: 12.5, lifetimeEnergy: 1500 },
    [LADER_B]: { chargerOpMode: 1, isOnline: true, totalPower: 0, sessionEnergy: 0, lifetimeEnergy: 80 },
  };
  const forbruk = valg.forbruk ?? {
    [LADER_A]: [{ year: 2026, month: 8, consumption: 143.2 }, { year: 2026, month: 9, consumption: 21.5 }],
    [LADER_B]: [{ year: 2026, month: 9, consumption: 4 }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      const metode = init?.method ?? "GET";
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      const kropp = init?.body ? JSON.parse(String(init.body)) : undefined;
      kall.push({ metode, sti: `${u.pathname}${u.search}`, auth, kropp });

      // hvakosterstrommen.no — én fil per dag og område, kvartersoppløsning som i virkeligheten.
      if (u.hostname === "www.hvakosterstrommen.no") {
        const m = /\/api\/v1\/prices\/(\d{4})\/(\d{2})-(\d{2})_(NO\d)\.json$/.exec(u.pathname);
        if (!m || m[4] !== "NO9") return new Response("not found", { status: 404 });
        const dag = `${m[1]}-${m[2]}-${m[3]}`;
        const rader = Object.entries(valg.spot ?? {})
          .filter(([iso]) => iso.startsWith(dag))
          .flatMap(([iso, pris]) => [0, 15, 30, 45].map((min) => {
            const start = new Date(new Date(iso).getTime() + min * 60000);
            return { NOK_per_kWh: pris, EUR_per_kWh: pris / 11, EXR: 11, time_start: start.toISOString(), time_end: new Date(start.getTime() + 15 * 60000).toISOString() };
          }));
        return rader.length ? Response.json(rader) : new Response("not found", { status: 404 });
      }

      if (u.pathname === "/api/accounts/login") {
        if (kropp.userName !== KONTO.userName || kropp.password !== KONTO.password) return Response.json({ title: "Unauthorized" }, { status: 401 });
        gyldige.add(TOKEN_1);
        return Response.json({ accessToken: TOKEN_1, refreshToken: REFRESH_1, expiresIn: 3600, tokenType: "Bearer" });
      }
      if (u.pathname === "/api/accounts/refresh_token") {
        if (valg.fornyingFeiler || kropp.refreshToken !== REFRESH_1) return Response.json({ title: "Unauthorized" }, { status: 401 });
        fornyet++;
        gyldige.add(`access-token-fornyet-${fornyet}`);
        return Response.json({ accessToken: `access-token-fornyet-${fornyet}`, refreshToken: REFRESH_1, expiresIn: 3600 });
      }
      if (!auth?.startsWith("Bearer ") || !gyldige.has(auth.slice(7))) return Response.json({ title: "Unauthorized" }, { status: 401 });

      if (u.pathname === "/api/accounts/profile") return Response.json({ userId: 1, eMail: "styret@ladelaget.no" });
      if (u.pathname === "/api/sites") return Response.json(anlegg.map((a) => ({ ...a, address: { street: "Ladebakken", buildingNumber: "1" } })));
      const detalj = /^\/api\/sites\/(\d+)$/.exec(u.pathname);
      if (detalj) {
        const a = anlegg.find((x) => x.id === Number(detalj[1]));
        if (!a) return Response.json({ title: "Not found" }, { status: 404 });
        return Response.json({ ...a, circuits: [{ id: 1, panelName: "Garasje", chargers: ladere }] });
      }
      const state = /^\/api\/sites\/(\d+)\/state$/.exec(u.pathname);
      if (state) {
        if (valg.tilstandFeiler) return new Response("boom", { status: 500 });
        return Response.json({
          circuitStates: [{ circuit: { id: 1 }, chargerStates: ladere.map((l) => ({ chargerID: l.id, chargerState: tilstand[l.id] ?? null })) }],
        });
      }
      const time = /^\/api\/chargers\/lifetime-energy\/([^/]+)\/hourly$/.exec(u.pathname);
      if (time) {
        const fra = new Date(u.searchParams.get("from")!).getTime();
        const til = new Date(u.searchParams.get("to")!).getTime();
        // Som ekte Easee (06.09.2026): mer enn ~31 dager med timer avvises.
        if (til - fra > 31 * 24 * 3600 * 1000) return Response.json("Too many timeperiods in specified interval, try a smaller interval or larger aggregation type", { status: 400 });
        return Response.json(
          (valg.timer?.[time[1]!] ?? [])
            .filter(([iso]) => new Date(iso).getTime() >= fra && new Date(iso).getTime() < til)
            .map(([iso, kwh]) => { const d = new Date(iso); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), consumption: kwh, date: iso }; }),
        );
      }
      const oktSti = /^\/api\/sessions\/charger\/([^/]+)\/sessions\/([^/]+)\/([^/]+)$/.exec(u.pathname);
      if (oktSti) {
        const fra = new Date(decodeURIComponent(oktSti[2]!)).getTime();
        const til = new Date(decodeURIComponent(oktSti[3]!)).getTime();
        return Response.json((valg.okter?.[oktSti[1]!] ?? []).filter((o) => { const t = new Date(o.carConnected).getTime(); return t >= fra && t < til; }).map((o) => ({ ...o, chargerId: oktSti[1], isComplete: Boolean(o.carDisconnected) })));
      }
      const mnd = /^\/api\/chargers\/lifetime-energy\/([^/]+)\/monthly$/.exec(u.pathname);
      if (mnd) {
        // Som ekte Easee: en måned er bare med når hele måneden ligger innenfor [from, to].
        const fra = new Date(u.searchParams.get("from")!);
        const til = new Date(u.searchParams.get("to")!);
        return Response.json((forbruk[mnd[1]!] ?? []).filter((m) => Date.UTC(m.year, m.month - 1, 1) >= fra.getTime() && Date.UTC(m.year, m.month, 1) <= til.getTime()));
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return { kall };
}

describe("adapteret", () => {
  it("hvitelista: innlogging/fornying og ellers bare lesing; ingen kommandoer eller innstillinger", () => {
    expect(TILLATTE_KALL.filter((k) => k.metode === "POST").map((k) => k.hva)).toEqual(["token fra brukernavn og passord", "fornye token"]);
    expect(TILLATTE_KALL.filter((k) => k.metode === "GET").length).toBe(7);
    expect(erTillatt("GET", `/api/chargers/lifetime-energy/${LADER_A}/hourly?from=x&to=y`)).toBe(true);
    expect(erTillatt("GET", `/api/sessions/charger/${LADER_A}/sessions/2026-07-01T00:00:00.000Z/2026-08-01T00:00:00.000Z`)).toBe(true);
    expect(erTillatt("DELETE", `/api/chargers/${LADER_A}/sessions/1`)).toBe(false);
    expect(erTillatt("GET", `/api/sites/${SITE}/state`)).toBe(true);
    expect(erTillatt("GET", `/api/chargers/lifetime-energy/${LADER_A}/monthly?from=x&to=y`)).toBe(true);
    // Det som IKKE skal kunne skje fra DriftIQ:
    expect(erTillatt("POST", `/api/chargers/${LADER_A}/commands/start_charging`)).toBe(false);
    expect(erTillatt("POST", `/api/chargers/${LADER_A}/commands/stop_charging`)).toBe(false);
    expect(erTillatt("POST", `/api/chargers/${LADER_A}/settings`)).toBe(false);
    expect(erTillatt("POST", `/api/sites/${SITE}/circuits/1/dynamicCurrent`)).toBe(false);
    expect(erTillatt("GET", `/api/chargers/${LADER_A}/state`)).toBe(false); // per lader = ratebegrensning; anlegget i ett kall
    expect(erTillatt("GET", "/api/chargers")).toBe(false); // 2 kall/min — anleggsdetaljen brukes i stedet
    expect(erTillatt("DELETE", `/api/sites/${SITE}`)).toBe(false);
  });

  it("kaster før nettet ved kall utenfor lista", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(easeeKall("t", "POST", `/api/chargers/${LADER_A}/commands/start_charging`)).rejects.toThrow(/hvitelista/);
    expect(f).not.toHaveBeenCalled();
  });

  it("flater ut ladere og tilstander, og oversetter opMode til norsk", () => {
    const l = laderneI({ id: 1, name: "x", circuits: [{ id: 1, panelName: "U1", chargers: [{ id: "B", name: "Bil 2" }, { id: "A", name: " Bil 1 " }] }, { id: 2, chargers: [{ id: "C", name: "" }] }] });
    expect(l.map((x) => [x.id, x.name, x.circuitName])).toEqual([["A", "Bil 1", "U1"], ["B", "Bil 2", "U1"], ["C", "C", null]]);
    const t = tilstandeneI({ circuitStates: [{ chargerStates: [{ chargerID: "A", chargerState: { chargerOpMode: 3 } }, { chargerID: "B", chargerState: null }] }] });
    expect([...t.keys()]).toEqual(["A"]);
    expect(opModeTekst(3, true).etikett).toBe("Lader");
    expect(opModeTekst(3, false).etikett).toBe("Frakoblet");
    expect(opModeTekst(null, null).etikett).toBe("Ukjent");
    expect(opModeTekst(42, true).etikett).toBe("Tilstand 42");
  });

  it("forbruksperioden er hele UTC-måneder: fra tolv måneder tilbake til 1. i neste måned", () => {
    expect(forbrukFra(new Date("2026-09-06T14:00:00Z")).toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(forbrukFra(new Date("2026-01-15T00:00:00Z"), 2).toISOString()).toBe("2025-12-01T00:00:00.000Z");
    // Inneværende måned kommer bare med hos Easee når `to` dekker hele måneden.
    expect(forbrukTil(new Date("2026-09-06T14:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(forbrukTil(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("koblingen", () => {
  it("logger inn med brukernavn/passord, velger det ene anlegget, speiler laderne og lagrer tokenene kryptert — aldri passordet", async () => {
    const { orgId } = await oppsett();
    const { kall } = stubbEasee();
    const status = await i(orgId, (db) => kobleTil(db, orgId, kari, { ...KONTO, siteId: null }));
    expect(status.kobling?.siteId).toBe(SITE);
    expect(status.kobling?.siteName).toBe("Sameiet Ladebakken");
    expect(status.kobling?.userName).toBe(KONTO.userName);
    expect(status.kobling?.accountEmail).toBe("styret@ladelaget.no");
    expect(status.kobling?.connectedBy).toBe("Kari Styreleder");
    expect(status.ladere).toEqual({ antall: 2, koblet: 0 });
    expect(JSON.stringify(status)).not.toContain(KONTO.password);
    expect(JSON.stringify(status)).not.toContain(TOKEN_1);
    expect(kall.filter((k) => k.sti === "/api/accounts/login").length).toBe(1);

    const rad = await eier.query("SELECT * FROM easee_settings WHERE org_id = $1", [orgId]);
    expect(rad.rows[0].access_token_enc).toMatch(/^v1:/);
    expect(rad.rows[0].refresh_token_enc).toMatch(/^v1:/);
    expect(JSON.stringify(rad.rows[0])).not.toContain(KONTO.password);
    expect(JSON.stringify(rad.rows[0])).not.toContain(TOKEN_1);
    expect(JSON.stringify(rad.rows[0])).not.toContain(REFRESH_1);
    expect(new Date(rad.rows[0].token_expires_at).getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);

    const ladere = await eier.query("SELECT charger_id, name, circuit_name, active FROM easee_chargers WHERE org_id = $1 ORDER BY name", [orgId]);
    expect(ladere.rows).toEqual([
      { charger_id: LADER_A, name: "Plass 1", circuit_name: "Garasje", active: true },
      { charger_id: LADER_B, name: "Plass 2", circuit_name: "Garasje", active: true },
    ]);

    const logg = await eier.query("SELECT event, module FROM audit_events WHERE org_id = $1", [orgId]);
    expect(logg.rows[0].module).toBe("parkering");
    expect(logg.rows[0].event).toMatch(/Koblet ladeanlegget til Easee-anlegget «Sameiet Ladebakken» \(2 ladere\)/);
  });

  it("avviser feil passord uten å lagre noe", async () => {
    const { orgId } = await oppsett();
    stubbEasee();
    const e = await feilFra(() => i(orgId, (db) => kobleTil(db, orgId, kari, { ...KONTO, password: "feil", siteId: null })));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/avviste brukernavn eller passord/);
    expect((await eier.query("SELECT 1 FROM easee_settings WHERE org_id = $1", [orgId])).rowCount).toBe(0);
  });

  it("krever valg når nøkkelen når flere anlegg — og navngir dem", async () => {
    const { orgId } = await oppsett();
    stubbEasee({ anlegg: [{ id: SITE, name: "Sameiet Ladebakken" }, { id: 4712, name: "Garasjelaget" }] });
    const e = await feilFra(() => i(orgId, (db) => kobleTil(db, orgId, kari, { ...KONTO, siteId: null })));
    expect(e.status).toBe(400);
    expect(e.message).toContain("Sameiet Ladebakken, Ladebakken 1 (id 4711)");
    expect(e.message).toContain("Garasjelaget");
    const status = await i(orgId, (db) => kobleTil(db, orgId, kari, { ...KONTO, siteId: 4712 }));
    expect(status.kobling?.siteName).toBe("Garasjelaget");
  });

  it("frakobling fjerner tokenene, men beholder ladere, plasskobling og forbruk", async () => {
    const { orgId, p1 } = await oppsett();
    stubbEasee();
    await i(orgId, (db) => kobleTil(db, orgId, kari, { ...KONTO, siteId: null }));
    const l = await i(orgId, (db) => hentLading(db, orgId));
    await i(orgId, (db) => kobleLaderTilPlass(db, orgId, kari, l.ladere[0]!.id, { spotId: p1 }));
    await i(orgId, (db) => kobleFra(db, orgId, kari));
    expect((await i(orgId, (db) => hentKobling(db, orgId))).kobling).toBeNull();
    expect((await eier.query("SELECT 1 FROM easee_chargers WHERE org_id = $1 AND spot_id = $2", [orgId, p1])).rowCount).toBe(1);
    expect(Number((await eier.query("SELECT count(*) FROM easee_charger_usage WHERE org_id = $1", [orgId])).rows[0].count)).toBe(3);
    const etter = await i(orgId, (db) => hentLading(db, orgId));
    expect(etter.koblet).toBe(false);
    expect(etter.ladere.length).toBe(2);
  });
});

describe("lading-fanen", () => {
  async function koblet(valg: Stubbvalg = {}) {
    const o = await oppsett();
    const stubb = stubbEasee(valg);
    await i(o.orgId, (db) => kobleTil(db, o.orgId, kari, { ...KONTO, siteId: null }));
    return { ...o, ...stubb };
  }

  it("henter tilstanden for hele anlegget i ETT kall og forbruket per lader, og lagrer begge", async () => {
    const { orgId, kall } = await koblet();
    kall.length = 0;
    const l = await i(orgId, (db) => hentLading(db, orgId));
    expect(l.koblet).toBe(true);
    expect(l.feil).toBeNull();
    expect(l.anlegg?.siteName).toBe("Sameiet Ladebakken");
    expect(kall.filter((k) => k.sti.endsWith("/state")).length).toBe(1);
    expect(kall.filter((k) => k.sti.includes("/lifetime-energy/")).length).toBe(2);
    expect(kall.every((k) => k.metode === "GET")).toBe(true);

    const a = l.ladere.find((x) => x.chargerId === LADER_A)!;
    expect(a.opMode).toBe(3);
    expect(a.totalPower).toBe(7.2);
    expect(a.sessionEnergy).toBe(12.5);
    expect(a.stateCheckedAt).not.toBeNull();
    expect(l.forbruk).toEqual(
      expect.arrayContaining([
        { chargerRowId: a.id, year: 2026, month: 8, kwh: 143.2 },
        { chargerRowId: a.id, year: 2026, month: 9, kwh: 21.5 },
      ]),
    );
    expect(l.forbruk.length).toBe(3);
    expect(JSON.stringify(l)).not.toContain(TOKEN_1);

    // Fersk tilstand og ferskt forbruk hentes ikke på nytt ved neste åpning.
    kall.length = 0;
    await i(orgId, (db) => hentLading(db, orgId));
    expect(kall.length).toBe(0);

    // … men når holdbarheten er ute, hentes tilstand (og forbruk) igjen — og forbruket oppdateres, ikke dobles.
    const senere = new Date(Date.now() + FORBRUK_HOLDBARHET_MS + TILSTAND_HOLDBARHET_MS);
    await i(orgId, (db) => hentLading(db, orgId, { naa: senere }));
    expect(kall.filter((k) => k.sti.endsWith("/state")).length).toBe(1);
    expect(kall.filter((k) => k.sti.includes("/lifetime-energy/")).length).toBe(2);
    expect(Number((await eier.query("SELECT count(*) FROM easee_charger_usage WHERE org_id = $1", [orgId])).rows[0].count)).toBe(3);
  });

  it("«Oppdater fra Easee» speiler laderlista: nye kommer til, borte blir inaktive med forbruket i behold", async () => {
    const { orgId } = await koblet();
    await i(orgId, (db) => hentLading(db, orgId));
    stubbEasee({ ladere: [{ id: LADER_A, name: "Plass 1 (ny skilting)" }, { id: "EH000CCC", name: "Plass 3" }], forbruk: { [LADER_A]: [], EH000CCC: [] } });
    const l = await i(orgId, (db) => hentLading(db, orgId, { frisk: "alt" }));
    const perId = new Map(l.ladere.map((x) => [x.chargerId, x]));
    expect(perId.get(LADER_A)?.name).toBe("Plass 1 (ny skilting)");
    expect(perId.get(LADER_B)?.active).toBe(false);
    expect(perId.get("EH000CCC")?.active).toBe(true);
    // Forbruket til den fjernede laderen står fortsatt — avregningen for august skal ikke forsvinne.
    expect(l.forbruk.some((f) => f.chargerRowId === perId.get(LADER_B)?.id)).toBe(true);
  });

  it("svikter Easee, kommer fanen likevel — med sist kjente tall og feilen notert", async () => {
    const { orgId } = await koblet();
    await i(orgId, (db) => hentLading(db, orgId));
    stubbEasee({ tilstandFeiler: true });
    const senere = new Date(Date.now() + TILSTAND_HOLDBARHET_MS + 1000);
    const l = await i(orgId, (db) => hentLading(db, orgId, { naa: senere }));
    expect(l.koblet).toBe(true);
    expect(l.feil).toMatch(/Easee svarte 500|boom/);
    expect(l.ladere.find((x) => x.chargerId === LADER_A)?.opMode).toBe(3);
    expect((await i(orgId, (db) => hentKobling(db, orgId))).kobling?.lastError).toMatch(/500|boom/);
  });

  it("lader → plass: én per plass, plassen får ladepunkt, disponent og avtale følger med, hendelse logges", async () => {
    const { orgId, p1, p2 } = await koblet();
    const l = await i(orgId, (db) => hentLading(db, orgId));
    const a = l.ladere.find((x) => x.chargerId === LADER_A)!;
    const b = l.ladere.find((x) => x.chargerId === LADER_B)!;

    const koblet1 = await i(orgId, (db) => kobleLaderTilPlass(db, orgId, kari, a.id, { spotId: p1 }));
    expect(koblet1.spotId).toBe(p1);
    const plass = await eier.query("SELECT has_charger, charger_label FROM parking_spots WHERE id = $1", [p1]);
    expect(plass.rows[0]).toEqual({ has_charger: true, charger_label: "Easee Plass 1" });

    const e = await feilFra(() => i(orgId, (db) => kobleLaderTilPlass(db, orgId, kari, b.id, { spotId: p1 })));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/har allerede laderen «Plass 1»/);

    await i(orgId, (db) => kobleLaderTilPlass(db, orgId, kari, b.id, { spotId: p2 }));
    const etter = await i(orgId, (db) => hentLading(db, orgId));
    const bb = etter.ladere.find((x) => x.chargerId === LADER_B)!;
    expect(bb.plass).toEqual({ number: "P02", holderName: null, unitLabel: null });
    expect(bb.avtale).toEqual({ tenantName: "Leif Leietaker", powerBilling: "forbruk" });
    const aa = etter.ladere.find((x) => x.chargerId === LADER_A)!;
    expect(aa.plass?.holderName).toBe("Ola Beboer");
    expect(aa.avtale).toBeNull();

    await i(orgId, (db) => kobleLaderTilPlass(db, orgId, kari, a.id, { spotId: null }));
    expect((await i(orgId, (db) => hentLading(db, orgId))).ladere.find((x) => x.chargerId === LADER_A)?.spotId).toBeNull();

    const logg = await eier.query("SELECT event, entity, entity_id FROM audit_events WHERE org_id = $1 AND entity = 'easee_lader' ORDER BY occurred_at", [orgId]);
    expect(logg.rows.map((r) => r.event)).toEqual([
      `Koblet laderen «Plass 1» (${LADER_A}) til plass P01`,
      `Koblet laderen «Plass 2» (${LADER_B}) til plass P02`,
      `Løsnet laderen «Plass 1» (${LADER_A}) fra plassen`,
    ]);
    expect(logg.rows[0].entity_id).toBe(a.id);

    const status = await i(orgId, (db) => hentKobling(db, orgId));
    expect(status.ladere).toEqual({ antall: 2, koblet: 1 });
  });

  it("avviser plass fra en annen org", async () => {
    const { orgId } = await koblet();
    const annen = await oppsett();
    const l = await i(orgId, (db) => hentLading(db, orgId));
    const e = await feilFra(() => i(orgId, (db) => kobleLaderTilPlass(db, orgId, kari, l.ladere[0]!.id, { spotId: annen.p1 })));
    expect(e.status).toBe(404);
  });
});

describe("tokenfornying", () => {
  async function koblet(valg: Stubbvalg = {}) {
    const o = await oppsett();
    const stubb = stubbEasee(valg);
    await i(o.orgId, (db) => kobleTil(db, o.orgId, kari, { ...KONTO, siteId: null }));
    return { ...o, ...stubb };
  }

  it("fornyer før utløp og lagrer de nye tokenene — uten å logge inn på nytt", async () => {
    const { orgId, kall } = await koblet();
    kall.length = 0;
    const snart = new Date(Date.now() + 3600 * 1000 - TOKEN_MARGIN_MS + 1000);
    await i(orgId, (db) => hentLading(db, orgId, { naa: snart }));
    const forny = kall.filter((k) => k.sti === "/api/accounts/refresh_token");
    expect(forny.length).toBe(1);
    expect(forny[0]?.kropp).toEqual({ accessToken: TOKEN_1, refreshToken: REFRESH_1 });
    expect(kall.some((k) => k.sti === "/api/accounts/login")).toBe(false);
    expect(kall.filter((k) => k.sti.endsWith("/state")).map((k) => k.auth)).toEqual(["Bearer access-token-fornyet-1"]);
    const rad = await eier.query("SELECT token_expires_at FROM easee_settings WHERE org_id = $1", [orgId]);
    expect(new Date(rad.rows[0].token_expires_at).getTime()).toBe(snart.getTime() + 3600 * 1000);
  });

  it("401 midt i økten: fornyer én gang og prøver kallet på nytt", async () => {
    const { orgId } = await koblet();
    // Easee ugyldiggjør tokenet før utløp — bare fornyede tokens godtas fra nå.
    const { kall } = stubbEasee({ gyldigeTokens: [] });
    const senere = new Date(Date.now() + TILSTAND_HOLDBARHET_MS + 1000);
    const l = await i(orgId, (db) => hentLading(db, orgId, { naa: senere }));
    expect(l.feil).toBeNull();
    expect(kall.filter((k) => k.sti === "/api/accounts/refresh_token").length).toBe(1);
    expect(kall.filter((k) => k.sti.endsWith("/state")).map((k) => k.auth)).toEqual([`Bearer ${TOKEN_1}`, "Bearer access-token-fornyet-1"]);
  });

  it("dødt refresh token: fanen kommer med sist kjente tall, og meldingen ber om ny tilkobling", async () => {
    const { orgId } = await koblet();
    await i(orgId, (db) => hentLading(db, orgId));
    stubbEasee({ gyldigeTokens: [], fornyingFeiler: true });
    const senere = new Date(Date.now() + TILSTAND_HOLDBARHET_MS + 1000);
    const l = await i(orgId, (db) => hentLading(db, orgId, { naa: senere }));
    expect(l.feil).toMatch(/Easee-innloggingen er utløpt — koble til på nytt/);
    expect(l.ladere.find((x) => x.chargerId === LADER_A)?.opMode).toBe(3);
    expect((await i(orgId, (db) => hentKobling(db, orgId))).kobling?.lastError).toMatch(/koble til på nytt/);
  });
});

// Fast plan til utregningstestene: Norgespris 50 øre, nett 45/33 øre, natt 22–06 + helg, fastledd 100 kr.
const PLAN: Prisplan = { kraftModel: "norgespris", kraftOre: 50, paaslagOre: 0, priceArea: null, mvaProsent: 25, nettDagOre: 45, nettNattOre: 33, nattFra: 22, nattTil: 6, helgSomNatt: true, fastleddOre: 10_000 };
const SPOTPLAN: Prisplan = { ...PLAN, kraftModel: "spot", kraftOre: 0, paaslagOre: 5, priceArea: "NO5" };

describe("laderegler (ren utregning)", () => {
  it("natt er 22–06 i Oslo-tid og hele helgen — sommertid og vintertid", () => {
    expect(erNatt(new Date("2026-07-06T20:30:00Z"), PLAN)).toBe(true); // mandag 22:30 sommertid
    expect(erNatt(new Date("2026-07-06T19:30:00Z"), PLAN)).toBe(false); // mandag 21:30
    expect(erNatt(new Date("2026-07-07T03:59:00Z"), PLAN)).toBe(true); // tirsdag 05:59
    expect(erNatt(new Date("2026-07-07T04:00:00Z"), PLAN)).toBe(false); // tirsdag 06:00
    expect(erNatt(new Date("2026-01-12T21:30:00Z"), PLAN)).toBe(true); // mandag 22:30 vintertid
    expect(erNatt(new Date("2026-07-11T10:00:00Z"), PLAN)).toBe(true); // lørdag formiddag = helg
    expect(erNatt(new Date("2026-07-11T10:00:00Z"), { ...PLAN, helgSomNatt: false })).toBe(false);
    expect(erNatt(new Date("2026-07-06T02:00:00Z"), { ...PLAN, nattFra: 0, nattTil: 6 })).toBe(true); // natt som ikke krysser midnatt
  });

  it("spot: NOK/kWh uten mva → øre inkl. mva, og timer uten pris rapporteres — ikke 0", () => {
    expect(spotTilOre(0.8, 25)).toBe(100);
    expect(spotTilOre(0.8, 0)).toBe(80);
    expect(prisForTime(SPOTPLAN, new Date("2026-07-06T10:00:00Z"), 0.8)).toEqual({ kraftOre: 105, nettOre: 45, natt: false });
    expect(prisForTime(SPOTPLAN, new Date("2026-07-06T10:00:00Z"), null)).toEqual({ kraftOre: null, nettOre: 45, natt: false });
    expect(prisForTime(PLAN, new Date("2026-07-06T22:00:00Z"), null)).toEqual({ kraftOre: 50, nettOre: 33, natt: true });
  });

  it("summerer kostnad per time: kraft og nett hver for seg, dag og natt hver for seg", () => {
    const timer = [
      { start: new Date("2026-07-06T10:00:00Z"), kwh: 10 }, // dag: 10 × (50 + 45)
      { start: new Date("2026-07-06T21:00:00Z"), kwh: 4 }, // natt (23:00 Oslo): 4 × (50 + 33)
      { start: new Date("2026-07-06T11:00:00Z"), kwh: 0 }, // hopper over
    ];
    expect(beregnKostnad(PLAN, timer)).toEqual({ kwhDag: 10, kwhNatt: 4, kraftOre: 700, nettOre: 582, timerUtenPris: 0, kwhUtenPris: 0 });
    const spot = new Map([[new Date("2026-07-06T10:00:00Z").getTime(), 0.8]]);
    const k = beregnKostnad(SPOTPLAN, timer, spot);
    expect(k.kraftOre).toBe(1050); // bare dagtimen har pris: 10 × 105
    expect(k.timerUtenPris).toBe(1);
    expect(k.kwhUtenPris).toBe(4);
  });

  it("planen for en måned er den nyeste som gjaldt den 1., og månedsgrensene er Oslo-midnatt", () => {
    const planer = [{ validFrom: "2026-01-01", n: "spot" }, { validFrom: "2025-10-01", n: "norgespris" }];
    expect(gjeldendePlan(planer, 2025, 12)?.n).toBe("norgespris");
    expect(gjeldendePlan(planer, 2026, 1)?.n).toBe("spot");
    expect(gjeldendePlan(planer, 2025, 9)).toBeNull();
    const juli = maanedsgrenser(2026, 7);
    expect(juli.fra.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(juli.til.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    const jan = maanedsgrenser(2026, 1);
    expect(jan.fra.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(maanedsgrenser(2026, 12).til.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("spotpriser: kvarter slås sammen til timer, 404 = tom liste", async () => {
    stubbEasee({ spot: { "2026-07-06T10:00:00.000Z": 0.8, "2026-07-06T11:00:00.000Z": 1.2 } });
    const t = await hentSpotpriser("2026-07-06", "NO9");
    expect(t.map((x) => [x.hourStart.toISOString(), x.nokPerKwh])).toEqual([["2026-07-06T10:00:00.000Z", 0.8], ["2026-07-06T11:00:00.000Z", 1.2]]);
    expect(await hentSpotpriser("2026-07-07", "NO9")).toEqual([]);
  });
});

describe("prisplaner", () => {
  const inn = { validFrom: "2026-01-01", name: "Norgespris", kraftModel: "norgespris" as const, kraftOre: 50, paaslagOre: 0, priceArea: null, mvaProsent: 25, nettDagOre: 45, nettNattOre: 33, nattFra: 22, nattTil: 6, helgSomNatt: true, fastleddOre: 10_000, note: null };

  it("opprettes, endres og slettes med hendelse; én plan per gyldig-fra; spot krever prisområde", async () => {
    const { orgId } = await oppsett();
    const planer = await i(orgId, (db) => lagrePrisplan(db, orgId, kari, inn));
    expect(planer.length).toBe(1);
    expect(planer[0]?.fastleddOre).toBe(10_000);
    const e1 = await feilFra(() => i(orgId, (db) => lagrePrisplan(db, orgId, kari, { ...inn, name: "Dublett" })));
    expect(e1.message).toMatch(/allerede en prisplan som gjelder fra 2026-01-01/);
    const e2 = await feilFra(() => i(orgId, (db) => lagrePrisplan(db, orgId, kari, { ...inn, validFrom: "2026-06-01", kraftModel: "spot", priceArea: null })));
    expect(e2.message).toMatch(/prisområde/);
    const endret = await i(orgId, (db) => lagrePrisplan(db, orgId, kari, { ...inn, name: "Norgespris (justert)", kraftOre: 55 }, planer[0]!.id));
    expect(endret[0]?.kraftOre).toBe(55);
    await i(orgId, (db) => slettPrisplan(db, orgId, kari, planer[0]!.id));
    expect(await i(orgId, (db) => hentPrisplaner(db, orgId))).toEqual([]);
    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 AND entity = 'easee_prisplan' ORDER BY occurred_at", [orgId]);
    expect(logg.rows.map((r) => r.event)).toEqual([
      "Opprettet prisplanen «Norgespris» for lading fra 2026-01-01: Norgespris 0,50 kr/kWh, nettleie dag 0,45 / natt 0,33 kr/kWh, fastledd 100 kr/mnd",
      "Endret prisplanen «Norgespris (justert)» for lading fra 2026-01-01: Norgespris 0,55 kr/kWh, nettleie dag 0,45 / natt 0,33 kr/kWh, fastledd 100 kr/mnd",
      "Slettet prisplanen «Norgespris (justert)» for lading (gjaldt fra 2026-01-01)",
    ]);
  });
});

describe("synk og rapport", () => {
  // Juli 2026: lader A på P01 (seksjon H0101, eier Ola), lader B på P02 (leietaker Leif, uten seksjon).
  const TIMER = {
    [LADER_A]: [["2026-07-06T10:00:00.000Z", 10], ["2026-07-06T21:00:00.000Z", 4], ["2026-07-11T08:00:00.000Z", 6]] as Array<[string, number]>, // dag 10, natt 4 + 6 (lørdag)
    [LADER_B]: [["2026-07-20T12:00:00.000Z", 2]] as Array<[string, number]>,
  };
  const OKTER: Record<string, Array<{ id: number; carConnected: string; carDisconnected: string | null; kiloWattHours: number }>> = {
    [LADER_A]: [
      { id: 101, carConnected: "2026-07-06T09:50:00Z", carDisconnected: "2026-07-06T23:10:00Z", kiloWattHours: 14 },
      { id: 102, carConnected: "2026-07-11T07:30:00Z", carDisconnected: "2026-07-11T09:00:00Z", kiloWattHours: 6 },
    ],
    [LADER_B]: [{ id: 201, carConnected: "2026-07-20T11:55:00Z", carDisconnected: null, kiloWattHours: 2 }],
  };
  const NAA = new Date("2026-07-25T12:00:00Z");

  async function medData(valg: Stubbvalg = {}) {
    const o = await oppsett();
    const stubb = stubbEasee({ timer: TIMER, okter: OKTER, ...valg });
    await i(o.orgId, (db) => kobleTil(db, o.orgId, kari, { ...KONTO, siteId: null }, NAA));
    const l = await i(o.orgId, (db) => hentLading(db, o.orgId, { naa: NAA }));
    const a = l.ladere.find((x) => x.chargerId === LADER_A)!;
    const b = l.ladere.find((x) => x.chargerId === LADER_B)!;
    await i(o.orgId, (db) => kobleLaderTilPlass(db, o.orgId, kari, a.id, { spotId: o.p1 }));
    await i(o.orgId, (db) => kobleLaderTilPlass(db, o.orgId, kari, b.id, { spotId: o.p2 }));
    return { ...o, ...stubb, a, b };
  }

  it("jobben henter timer og økter per lader (nulltimer lagres ikke), og henter bare nytt neste gang", async () => {
    const { orgId, kall } = await medData();
    kall.length = 0;
    const r = await i(orgId, (db) => synkEasee(db, orgId, NAA));
    expect(r).toMatchObject({ ladere: 2, timer: 4, okter: 3, spotdager: 0 });
    // 92 dager tilbakefyll i vinduer på 28 dager = 4 kall per lader — Easee avviser større vinduer.
    expect(kall.filter((k) => k.sti.includes("/hourly")).length).toBe(8);
    expect(kall.filter((k) => k.sti.includes("/sessions/")).length).toBe(8);
    expect(Number((await eier.query("SELECT count(*) FROM easee_charger_hours WHERE org_id = $1", [orgId])).rows[0].count)).toBe(4);
    expect(Number((await eier.query("SELECT count(*) FROM easee_sessions WHERE org_id = $1", [orgId])).rows[0].count)).toBe(3);

    // Andre synk: fra siste time minus overlapp — ingen dubletter, og en økt som ble ferdig oppdateres.
    OKTER[LADER_B]![0]!.carDisconnected = "2026-07-20T14:00:00Z";
    kall.length = 0;
    await i(orgId, (db) => synkEasee(db, orgId, new Date("2026-07-26T12:00:00Z")));
    const fra = new URL(`https://x${kall.find((k) => k.sti.includes(`/lifetime-energy/${LADER_A}/hourly`))!.sti}`).searchParams.get("from")!;
    expect(new Date(fra).toISOString()).toBe("2026-07-09T08:00:00.000Z"); // siste time 11.07 08:00 − 48 t
    expect(kall.filter((k) => k.sti.includes(`/lifetime-energy/${LADER_A}/hourly`)).length).toBe(1); // 17 dager = ett vindu
    expect(Number((await eier.query("SELECT count(*) FROM easee_charger_hours WHERE org_id = $1", [orgId])).rows[0].count)).toBe(4);
    const okt = await eier.query("SELECT car_disconnected, is_complete FROM easee_sessions WHERE org_id = $1 AND easee_session_id = 201", [orgId]);
    expect(okt.rows[0].is_complete).toBe(true);
    OKTER[LADER_B]![0]!.carDisconnected = null;
  });

  it("rapporten: dag/natt, kraft, nett og fastledd per plass — med seksjon og eier fra økonomimodulen", async () => {
    const { orgId, unitId } = await medData();
    await i(orgId, (db) => synkEasee(db, orgId, NAA));
    const uten = await i(orgId, (db) => hentRapport(db, orgId, 2026, 7));
    expect(uten.plan).toBeNull();
    expect(uten.advarsler[0]).toMatch(/Ingen prisplan/);
    expect(uten.linjer.map((l) => [l.plass?.number, l.kwh])).toEqual([["P01", 20], ["P02", 2]]);

    await i(orgId, (db) => lagrePrisplan(db, orgId, kari, { ...PLAN, validFrom: "2026-01-01", name: "Norgespris", note: null }));
    const r = await i(orgId, (db) => hentRapport(db, orgId, 2026, 7));
    expect(r.plan?.name).toBe("Norgespris");
    const p01 = r.linjer[0]!;
    expect(p01.seksjon).toEqual({ id: unitId, navn: "H0101" });
    expect(p01.eier?.name).toBe("Ola Beboer");
    expect(p01.okter).toBe(2);
    expect(p01.kwhDag).toBe(10);
    expect(p01.kwhNatt).toBe(10);
    expect(p01.kraftOre).toBe(1000); // 20 × 50
    expect(p01.nettOre).toBe(10 * 45 + 10 * 33);
    expect(p01.fastleddOre).toBe(10_000);
    expect(p01.sumOre).toBe(1000 + 780 + 10_000);
    const p02 = r.linjer[1]!;
    expect(p02.seksjon).toBeNull();
    expect(p02.avtale).toEqual({ tenantName: "Leif Leietaker", powerBilling: "forbruk" });
    expect(r.advarsler).toEqual([expect.stringMatching(/1 plass med lader mangler kobling til seksjon/)]);
    expect(r.sum.sumOre).toBe(p01.sumOre + p02.sumOre);

    // Måneden uten forbruk: bare fastledd for laderne som står på plass.
    const aug = await i(orgId, (db) => hentRapport(db, orgId, 2026, 8));
    expect(aug.linjer.map((l) => l.sumOre)).toEqual([10_000, 10_000]);

    const okter = await i(orgId, (db) => hentOkter(db, orgId, p01.laderId, 2026, 7));
    expect(okter.map((o) => o.kwh)).toEqual([6, 14]);

    // Laderlista: siste økt per lader, og tolv måneder med nattandel der timene finnes.
    const l = await i(orgId, (db) => hentLading(db, orgId, { frisk: false, naa: NAA }));
    const la = l.ladere.find((x) => x.chargerId === LADER_A)!;
    expect(la.sisteOkt?.kwh).toBe(6);
    expect(la.sisteOkt?.carConnected.toISOString()).toBe("2026-07-11T07:30:00.000Z");
    expect(l.maaneder.length).toBe(12);
    const juli = l.maaneder.find((m) => m.year === 2026 && m.month === 7)!;
    expect(juli.kwhNatt).toBe(10); // 4 (natt) + 6 (lørdag) på A; de 2 på B er dag
    expect(l.maaneder.find((m) => m.year === 2026 && m.month === 6)?.kwhNatt).toBeNull(); // ingen timer → ukjent, ikke 0

    const csv = await i(orgId, (db) => eksporterRapport(db, orgId, 2026, 7, kari));
    const tekst = new TextDecoder().decode(csv.innhold);
    expect(csv.navn).toBe("lading-2026-07.csv");
    expect(tekst).toContain("Ola Beboer");
    expect(tekst).toContain("117,80"); // sum P01 i kroner
    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 AND entity = 'easee_rapport'", [orgId]);
    expect(logg.rows[0].event).toMatch(/Eksporterte laderapporten for 2026-07/);
  });

  it("spotplan: prisene hentes for området, timer uten pris varsles, og mva + påslag legges på", async () => {
    const spot = { "2026-07-06T10:00:00.000Z": 0.8, "2026-07-06T21:00:00.000Z": 0.4 }; // lørdagstimen 11.07 mangler
    const { orgId, kall } = await medData({ spot });
    await i(orgId, (db) => lagrePrisplan(db, orgId, kari, { ...SPOTPLAN, priceArea: "NO9" as never, validFrom: "2026-01-01", name: "Spot", note: null }));
    const r1 = await i(orgId, (db) => synkEasee(db, orgId, NAA));
    expect(r1.spotdager).toBe(1);
    expect(kall.filter((k) => k.sti.includes("hvakosterstrommen") || k.sti.includes("/api/v1/prices/")).length).toBeGreaterThan(0);
    const r = await i(orgId, (db) => hentRapport(db, orgId, 2026, 7));
    const p01 = r.linjer[0]!;
    // 10 kWh × (100 + 5) + 4 kWh × (50 + 5) = 1050 + 220; lørdagens 6 kWh uten pris.
    expect(p01.kraftOre).toBe(1270);
    expect(p01.timerUtenPris).toBe(1);
    expect(p01.kwhUtenPris).toBe(6);
    expect(r.advarsler.some((a) => /mangler spotpris/.test(a))).toBe(true);
    // Neste synk henter ikke dagene som allerede ligger der.
    kall.length = 0;
    await i(orgId, (db) => synkEasee(db, orgId, NAA));
    expect(kall.filter((k) => k.sti.includes("/api/v1/prices/2026/07-06_")).length).toBe(0);
  });

  it("«Oppdater fra Easee» henter også timer og økter", async () => {
    const { orgId, kall } = await medData();
    kall.length = 0;
    await i(orgId, (db) => hentLading(db, orgId, { frisk: "alt", naa: NAA }));
    expect(kall.filter((k) => k.sti.includes("/hourly")).length).toBe(8);
    expect(Number((await eier.query("SELECT count(*) FROM easee_sessions WHERE org_id = $1", [orgId])).rows[0].count)).toBe(3);
  });

  it("plass med seksjon: visningsteksten følger seksjonen, og seksjon fra annen org avvises", async () => {
    const { orgId, unitId } = await oppsett();
    const annen = await oppsett();
    const p = await i(orgId, (db) => opprettPlass(db, orgId, { number: "G07", ownershipType: "felles", spotType: "standard", status: "ledig", hasCharger: false, unitId, unitLabel: "feil" }));
    expect(p.unitId).toBe(unitId);
    expect(p.unitLabel).toBe("H0101");
    const e = await feilFra(() => i(orgId, (db) => opprettPlass(db, orgId, { number: "G08", ownershipType: "felles", spotType: "standard", status: "ledig", hasCharger: false, unitId: annen.unitId })));
    expect(e.status).toBe(404);
  });
});

describe("tenantisolasjon", () => {
  it("org A ser aldri org Bs kobling, ladere eller forbruk", async () => {
    const a = await oppsett();
    const b = await oppsett();
    stubbEasee();
    await i(a.orgId, (db) => kobleTil(db, a.orgId, kari, { ...KONTO, siteId: null }));
    await i(a.orgId, (db) => hentLading(db, a.orgId));

    expect((await i(b.orgId, (db) => hentKobling(db, b.orgId))).kobling).toBeNull();
    const lb = await i(b.orgId, (db) => hentLading(db, b.orgId));
    expect(lb.koblet).toBe(false);
    expect(lb.ladere).toEqual([]);
    expect(lb.forbruk).toEqual([]);

    const la = await i(a.orgId, (db) => hentLading(db, a.orgId));
    const e = await feilFra(() => i(b.orgId, (db) => kobleLaderTilPlass(db, b.orgId, kari, la.ladere[0]!.id, { spotId: b.p1 })));
    expect(e.status).toBe(404);
  });
});
