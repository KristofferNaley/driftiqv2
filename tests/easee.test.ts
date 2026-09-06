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
  forbrukFra,
  forbrukTil,
  hentKobling,
  hentLading,
  kobleFra,
  kobleLaderTilPlass,
  kobleTil,
  settPris,
} from "../src/lib/easeekobling";

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
    await eier.query("DELETE FROM easee_chargers WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM easee_settings WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM parking_leases WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM parking_spots WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function oppsett() {
  const orgId = `eas-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [orgId, "Ladelaget", orgId]);
  ryddOrg.push(orgId);
  const p1 = randomUUID();
  const p2 = randomUUID();
  await eier.query("INSERT INTO parking_spots (id, org_id, number, holder_name, unit_label, has_charger) VALUES ($1,$2,'P01','Ola Beboer','H0101',false)", [p1, orgId]);
  await eier.query("INSERT INTO parking_spots (id, org_id, number, has_charger, status) VALUES ($1,$2,'P02',true,'utleid')", [p2, orgId]);
  await eier.query(
    "INSERT INTO parking_leases (id, org_id, spot_id, tenant_name, price_per_month, power_billing) VALUES ($1,$2,$3,'Leif Leietaker',900,'forbruk')",
    [randomUUID(), orgId, p2],
  );
  return { orgId, p1, p2 };
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
    expect(TILLATTE_KALL.filter((k) => k.metode === "GET").length).toBe(5);
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

  it("strømprisen lagres i øre og logges i kroner", async () => {
    const { orgId } = await oppsett();
    stubbEasee();
    await i(orgId, (db) => kobleTil(db, orgId, kari, { ...KONTO, siteId: null }));
    const s = await i(orgId, (db) => settPris(db, orgId, kari, { pricePerKwhOre: 185 }));
    expect(s.kobling?.pricePerKwhOre).toBe(185);
    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 ORDER BY occurred_at DESC LIMIT 1", [orgId]);
    expect(logg.rows[0].event).toMatch(/1,85 kr\/kWh/);
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
