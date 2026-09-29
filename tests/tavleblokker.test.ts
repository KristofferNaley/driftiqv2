/**
 * Oppslagstavla — maler, soner og innholdsblokkene vær (MET/yr) og avganger (Entur). Ingen
 * v1-forgjenger; bygget fra API-ene slik de svarte 29.09.2026 (docs/entur-yr.md), med et
 * ekte MET-svar som fixture.
 *
 * Tyngdepunktet: at skjermen bare får det som står i sonene sine, at mellomlagrene faktisk
 * sparer kall (vilkårene til MET og Entur), og at en tredjepart som feiler gir en blokk som
 * forsvinner eller viser forrige svar — aldri en tavle som ikke svarer.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { anonymAktor } from "../src/lib/aktor";
import { TILLATTE_KALL as ENTUR_KALL, avgangerFra, tolkAvganger, tolkHoldeplasser, tomEnturLager } from "../src/lib/entur";
import { endreSkjerm, innholdForSkjerm, kobleSkjerm, sjekkKobling, startKobling } from "../src/lib/oppslagstavle";
import { blokkInn, hentBlokker, opprettBlokk, slettBlokk } from "../src/lib/tavleblokker";
import { MALER, STANDARD_MAL, finnMal, lesSoner } from "../src/lib/tavlemaler";
import { avgangstid, vaersymbol } from "../src/lib/vaerregler";
import { tolkVarsel, tomYrLager, varselFor } from "../src/lib/yr";

const KARI = anonymAktor("Kari");
const MET = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", "met-locationforecast.json"), "utf8"));
/** Et tidspunkt inne i fixturen: 29.09.2026 kl. 22:30 Oslo. */
const FIXTURTID = new Date("2026-09-29T20:30:00Z");

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddKoder: string[] = [];

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  tomEnturLager();
  tomYrLager();
  for (const kode of ryddKoder.splice(0)) await eier.query("DELETE FROM board_pairings WHERE code = $1", [kode]);
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM board_blocks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_pairings WHERE screen_id IN (SELECT id FROM board_screens WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM board_screens WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `blokk-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,'Blokklaget',$2,true)", [id, id]);
  ryddOrg.push(id);
  return id;
}

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    return e as ApiFeil;
  }
  throw new Error("Forventet feil, men kallet lyktes");
}

async function kobletSkjerm(orgId: string, retning: "staende" | "liggende" = "liggende") {
  const k = await startKobling();
  ryddKoder.push(k.kode);
  const skjerm = await withOrg(orgId, (db) => kobleSkjerm(db, orgId, KARI, { kode: k.kode, navn: "A", adresse: null, retning }));
  const svar = await sjekkKobling(k.hemmelighet);
  if (svar.status !== "koblet") throw new Error("ikke koblet");
  return { skjerm, token: svar.token };
}

const medToken = (t: string) => new Request("http://localhost/", { headers: { authorization: `Bearer ${t}` } });

const VAER = { type: "vaer" as const, navn: "Været", konfig: { sted: "Håsteins gate 9, Bergen", lat: 60.386254326, lon: 5.297156848, visning: "timer" as const } };
const AVGANGER = { type: "avganger" as const, navn: "Buss", konfig: { holdeplasser: [{ id: "NSR:StopPlace:61380", navn: "Danmarks plass" }] } };

/** Tredjepartene på «nettet». Teller kallene, så mellomlagrene kan testes. */
function nettet(opts: { met?: () => Response; entur?: () => Response } = {}) {
  const kall = { met: 0, entur: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://api.met.no/")) {
        kall.met++;
        return (opts.met ?? (() => Response.json(MET, { headers: { expires: new Date(Date.now() + 1_800_000).toUTCString() } })))();
      }
      if (u.startsWith("https://api.entur.io/journey-planner/")) {
        kall.entur++;
        return (opts.entur ?? (() => Response.json(enturSvar(new Date(Date.now() + 5 * 60_000)))))();
      }
      throw new Error(`Uventet kall: ${u}`);
    }),
  );
  return kall;
}

function enturSvar(tid: Date) {
  return {
    data: {
      stopPlace: {
        name: "Danmarks plass",
        estimatedCalls: [
          {
            expectedDepartureTime: tid.toISOString(),
            realtime: true,
            cancellation: false,
            destinationDisplay: { frontText: "Bergen lufthavn" },
            serviceJourney: { line: { publicCode: "1", transportMode: "tram" } },
          },
        ],
      },
    },
  };
}

describe("maler og soner", () => {
  it("hver retning har en standardmal, og hver mal har områder for alle sonene sine", () => {
    for (const r of ["liggende", "staende"] as const) expect(finnMal(null, r).id).toBe(STANDARD_MAL[r]);
    for (const m of MALER) {
      const iOmrader = new Set(m.omrader.join(" ").split(" "));
      expect([...iOmrader].sort(), m.id).toEqual([...m.soner].sort());
      expect(m.omrader.every((r) => r.split(" ").length === m.omrader[0]!.split(" ").length), m.id).toBe(true);
    }
  });

  it("en mal for den andre retningen gir standardmalen", () => {
    expect(finnMal("s-stor-to", "liggende").id).toBe("l-stor-to");
  });

  it("lesSoner fjerner ukjente blokker og soner malen ikke har, og ødelagt JSON gir standarden", () => {
    const mal = finnMal("l-to-like", "liggende");
    const gyldige = new Set(["oppslag", "kalender", "kontakt"]);
    expect(lesSoner(JSON.stringify({ a: ["oppslag", "blokk:borte"], b: ["kalender"], d: ["kontakt"] }), mal, gyldige)).toEqual({
      a: ["oppslag"],
      b: ["kalender"],
      stripe: [],
    });
    expect(lesSoner("{ødelagt", mal, gyldige).a).toEqual(["oppslag"]);
  });
});

describe("blokker og skjermen", () => {
  it("skjermen får bare blokkene som står i en sone — og data for dem", async () => {
    const orgId = await nyOrg();
    const kall = nettet();
    const vaer = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, VAER));
    await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, AVGANGER));
    const { skjerm, token } = await kobletSkjerm(orgId);

    // Standardfordelingen har ingen egne blokker: ingen kall til MET eller Entur.
    expect((await innholdForSkjerm(medToken(token))).blokker).toEqual({});
    expect(kall).toEqual({ met: 0, entur: 0 });

    await withOrg(orgId, (db) =>
      endreSkjerm(db, orgId, skjerm.id, {
        navn: "A", adresse: null, retning: "liggende", skala: 85, mal: "l-stor-to",
        soner: { a: ["oppslag"], b: [vaer.nokkel], c: ["kontakt"], stripe: [] },
      }),
    );
    const innhold = await innholdForSkjerm(medToken(token));
    expect(Object.keys(innhold.blokker)).toEqual([vaer.nokkel]);
    expect(innhold.blokker[vaer.nokkel]).toMatchObject({ type: "vaer", sted: "Håsteins gate 9, Bergen" });
    expect(kall).toEqual({ met: 1, entur: 0 });
  });

  it("MET-koordinatene lagres med fire desimaler", async () => {
    const orgId = await nyOrg();
    const b = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, VAER));
    expect(b.konfig).toMatchObject({ lat: 60.3863, lon: 5.2972 });
  });

  it("en slettet blokk fjernes fra sonene på skjermene", async () => {
    const orgId = await nyOrg();
    nettet();
    const b = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, AVGANGER));
    const { skjerm } = await kobletSkjerm(orgId);
    await withOrg(orgId, (db) =>
      endreSkjerm(db, orgId, skjerm.id, {
        navn: "A", adresse: null, retning: "liggende", skala: 85, mal: "l-to-like",
        soner: { a: ["oppslag"], b: [b.nokkel, "kalender"], stripe: [] },
      }),
    );
    await withOrg(orgId, (db) => slettBlokk(db, orgId, b.id));
    const { rows } = await eier.query("SELECT zones FROM board_screens WHERE id = $1", [skjerm.id]);
    expect(JSON.parse(rows[0].zones).b).toEqual(["kalender"]);
  });

  it("en annen orgs blokk kan ikke plasseres på skjermen", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const fremmed = await withOrg(b, (db) => opprettBlokk(db, b, KARI, VAER));
    const { skjerm } = await kobletSkjerm(a);
    const endret = await withOrg(a, (db) =>
      endreSkjerm(db, a, skjerm.id, {
        navn: "A", adresse: null, retning: "liggende", skala: 85, mal: "l-to-like",
        soner: { a: [fremmed.nokkel], b: [], stripe: [] },
      }),
    );
    expect(endret.soner.a).toEqual([]);
    expect(await withOrg(a, (db) => hentBlokker(db, a))).toEqual([]);
  });

  it("validering: sted utenfor Norge, for mange holdeplasser og ugyldig holdeplass-id", () => {
    expect(blokkInn.safeParse({ ...VAER, konfig: { ...VAER.konfig, lat: 48.85, lon: 2.35 } }).success).toBe(false);
    const tre = [1, 2, 3].map((n) => ({ id: `NSR:StopPlace:${n}`, navn: `H${n}` }));
    expect(blokkInn.safeParse({ ...AVGANGER, konfig: { holdeplasser: tre } }).success).toBe(false);
    expect(blokkInn.safeParse({ ...AVGANGER, konfig: { holdeplasser: [{ id: "../../x", navn: "x" }] } }).success).toBe(false);
  });

  it("en blokk kan ikke bytte type", async () => {
    const orgId = await nyOrg();
    const b = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, VAER));
    const { endreBlokk } = await import("../src/lib/tavleblokker");
    const feil = await feilFra(() => withOrg(orgId, (db) => endreBlokk(db, orgId, b.id, AVGANGER)));
    expect(feil.status).toBe(400);
  });

  it("en skalering utenfor lista avvises", async () => {
    const orgId = await nyOrg();
    const { skjerm } = await kobletSkjerm(orgId);
    const { skjermEndring } = await import("../src/lib/oppslagstavle");
    expect(skjermEndring.safeParse({ navn: "A", retning: "liggende", skala: 55, mal: "l-to-like", soner: {} }).success).toBe(false);
    expect(skjerm.skala).toBe(85);
  });
});

describe("Entur", () => {
  it("hvitelista er holdeplassøk og avganger", () => {
    expect(ENTUR_KALL.map((k) => k.hva)).toEqual(["søk etter holdeplass", "neste avganger fra én holdeplass"]);
  });

  it("tolker holdeplasser og hopper over treff som ikke er holdeplasser", () => {
    const t = tolkHoldeplasser({
      features: [
        { properties: { id: "NSR:StopPlace:61380", name: "Danmarks plass", locality: "Bergen", mode: [{ bus: null }, { tram: "cityTram" }] } },
        { properties: { id: "KVE:TopographicPlace:4601", name: "Bergen" } },
      ],
    });
    expect(t).toEqual([{ id: "NSR:StopPlace:61380", navn: "Danmarks plass", sted: "Bergen", moduser: ["bus", "tram"] }]);
  });

  it("tolker avganger, og en GraphQL-feil er en feil", () => {
    const tid = new Date();
    expect(tolkAvganger(enturSvar(tid))).toEqual([
      { linje: "1", modus: "tram", mot: "Bergen lufthavn", tid: tid.toISOString(), sanntid: true, innstilt: false },
    ]);
    expect(() => tolkAvganger({ errors: [{ message: "Ugyldig id" }] })).toThrow("Ugyldig id");
  });

  it("mellomlageret: ett kall per holdeplass per halvminutt, og forrige svar når Entur feiler", async () => {
    const naa = Date.now();
    let feiler = false;
    const kall = nettet({ entur: () => (feiler ? new Response("nede", { status: 500 }) : Response.json(enturSvar(new Date(naa + 600_000)))) });
    await avgangerFra("NSR:StopPlace:1", 6, naa);
    await avgangerFra("NSR:StopPlace:1", 6, naa + 10_000);
    expect(kall.entur).toBe(1);
    feiler = true;
    const reserve = await avgangerFra("NSR:StopPlace:1", 6, naa + 60_000);
    expect(kall.entur).toBe(2);
    expect(reserve).toHaveLength(1);
    // Uten noe i minnet og med Entur nede: tom liste, ingen kast.
    expect(await avgangerFra("NSR:StopPlace:2", 6, naa)).toEqual([]);
  });

  it("avgangstid som på skiltet: nå, minutter, klokkeslett", () => {
    const naa = new Date("2026-09-29T20:00:00Z");
    expect(avgangstid("2026-09-29T20:00:20Z", naa)).toBe("nå");
    expect(avgangstid("2026-09-29T20:04:30Z", naa)).toBe("4 min");
    expect(avgangstid("2026-09-29T20:40:00Z", naa)).toBe("22:40");
  });
});

describe("MET / yr", () => {
  it("tolker det ekte varselet: nå, de neste timene og dagene fra i morgen", () => {
    const v = tolkVarsel(MET, FIXTURTID);
    expect(v.naa.temp).toBe(9.8);
    expect(v.naa.symbol).toBe("partlycloudy_night");
    expect(v.timer).toHaveLength(12);
    expect(new Date(v.timer[0]!.tid).getTime()).toBeGreaterThan(FIXTURTID.getTime());
    expect(v.dager[0]!.dato).toBe("2026-09-30");
    expect(v.dager).toHaveLength(5);
    for (const d of v.dager) expect(d.maks).toBeGreaterThanOrEqual(d.min);
  });

  it("respekterer Expires, spør med If-Modified-Since etterpå, og bruker forrige svar ved feil", async () => {
    const hoder: Array<string | null> = [];
    let status = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        hoder.push(new Headers(init?.headers).get("If-Modified-Since"));
        if (status === 304) return new Response(null, { status: 304, headers: { expires: new Date(FIXTURTID.getTime() + 3_600_000).toUTCString() } });
        if (status === 500) return new Response("nede", { status: 500 });
        return Response.json(MET, {
          headers: { expires: new Date(FIXTURTID.getTime() + 600_000).toUTCString(), "last-modified": "Tue, 29 Sep 2026 20:41:44 GMT" },
        });
      }),
    );
    await varselFor(60.37, 5.34, FIXTURTID);
    await varselFor(60.37, 5.34, new Date(FIXTURTID.getTime() + 60_000));
    expect(hoder).toHaveLength(1);

    status = 304;
    await varselFor(60.37, 5.34, new Date(FIXTURTID.getTime() + 11 * 60_000));
    expect(hoder[1]).toBe("Tue, 29 Sep 2026 20:41:44 GMT");

    status = 500;
    tomYrLager();
    expect(await varselFor(60.37, 5.34, FIXTURTID)).toBeNull();
  });

  it("symbolkodene får ikon, med månen om natta og sludd før regn", () => {
    expect(vaersymbol("clearsky_night").ikon).toBe("Moon");
    expect(vaersymbol("clearsky_day").ikon).toBe("Sun");
    expect(vaersymbol("lightsleetshowers_day").tekst).toBe("Sludd");
    expect(vaersymbol("heavyrainandthunder").tekst).toBe("Torden");
    expect(vaersymbol("ukjent").ikon).toBe("Cloud");
  });

  it("MET nede uten noe i minnet: værblokken får varsel null, skjermen svarer likevel", async () => {
    const orgId = await nyOrg();
    nettet({ met: () => new Response("nede", { status: 503 }) });
    const vaer = await withOrg(orgId, (db) => opprettBlokk(db, orgId, KARI, VAER));
    const { skjerm, token } = await kobletSkjerm(orgId);
    await withOrg(orgId, (db) =>
      endreSkjerm(db, orgId, skjerm.id, {
        navn: "A", adresse: null, retning: "liggende", skala: 85, mal: "l-fullskjerm",
        soner: { a: ["oppslag"], stripe: [vaer.nokkel] },
      }),
    );
    const innhold = await innholdForSkjerm(medToken(token));
    expect(innhold.blokker[vaer.nokkel]).toMatchObject({ type: "vaer", varsel: null });
  });
});
