/**
 * Kundedetaljen, prismodellen og BBL-registeret — lagene bak plattformpanelets fase 2.
 *
 * Det som faktisk testes her er reglene som er lette å bryte uten at noe krasjer:
 * at abonnementet lagrer et snapshot av grunnpakken, at onboardingen ikke teller
 * DriftIQ-ansatte som kundens styre, og at et boligbyggelag i bruk ikke kan slettes bort
 * under føttene på kundene sine.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import * as bblLag from "../src/lib/bbl";
import {
  endreKunde,
  hentAbonnement,
  hentDetalj,
  hentOnboarding,
  settAbonnement,
  settModuler,
  settTilknytning,
  slettAbonnement,
} from "../src/lib/kundedetalj";
import { hentPrismodell, settPrismodell } from "../src/lib/prismodell";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddBruker: string[] = [];
const ryddBbl: string[] = [];

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
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM platform_contracts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM units WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
  // Ett `splice` — det TØMMER lista, så to av dem gjør at andre runde ikke sletter noe.
  const lag = ryddBbl.splice(0);
  // Peker før rad: et lag kan peke på et annet som etterfølger.
  for (const id of lag) {
    await eier.query("UPDATE bbl SET successor_id = NULL WHERE successor_id = $1", [id]);
  }
  for (const id of lag) {
    await eier.query("DELETE FROM bbl WHERE id = $1", [id]);
  }
});

const i = <T>(fn: (db: Parameters<Parameters<typeof withoutRls>[1]>[0]) => Promise<T>) =>
  withoutRls("plattformpanel", fn);

async function nyOrg(andeler: number | null = null): Promise<string> {
  const id = `kd-${randomUUID()}`;
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active, unit_count) VALUES ($1,$2,$1,true,$3)",
    [id, "Testlaget", andeler],
  );
  ryddOrg.push(id);
  return id;
}

async function nyBruker(orgId: string, rolle = "member"): Promise<string> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,'Test',$2,$3,true,true,now(),now())`,
    [id, `${id}@driftiq.test`, rolle],
  );
  await eier.query(
    "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'visning')",
    [randomUUID(), id, orgId],
  );
  ryddBruker.push(id);
  return id;
}

async function nyBbl(navn: string, aktiv = true): Promise<string> {
  const id = randomUUID();
  await eier.query("INSERT INTO bbl (id, name, active) VALUES ($1,$2,$3)", [id, navn, aktiv]);
  ryddBbl.push(id);
  return id;
}

// ── Abonnement ──────────────────────────────────────────────────────────────────────────

describe("abonnement", () => {
  it("lagrer grunnpakken som snapshot, regnet fra andelstallet", async () => {
    const org = await nyOrg(200);
    const a = await i((db) => settAbonnement(db, org, { moduler: [], discountPercent: 0 }));
    // 50×280 + 100×180 + 50×120
    expect(a!.baseFee).toBe(38_000);
  });

  it("lar snapshotet stå når andelstallet endres — inngåtte avtaler endrer seg ikke selv", async () => {
    const org = await nyOrg(200);
    await i((db) => settAbonnement(db, org, { moduler: [], discountPercent: 0 }));
    await i((db) => endreKunde(db, org, { unitCount: 400 }));

    const a = await i((db) => hentAbonnement(db, org));
    expect(a!.baseFee).toBe(38_000);

    // …men den som faktisk redigerer avtalen får dagens tall.
    const detalj = await i((db) => hentDetalj(db, org));
    expect(detalj.grunnpakkeNaa).toBe(62_000);
  });

  it("oppdaterer den eksisterende avtalen i stedet for å lage en ny", async () => {
    const org = await nyOrg(100);
    await i((db) => settAbonnement(db, org, { moduler: [], discountPercent: 0 }));
    await i((db) => settAbonnement(db, org, { moduler: [], discountPercent: 25 }));

    const { rows } = await eier.query("SELECT id FROM platform_contracts WHERE org_id = $1", [org]);
    expect(rows).toHaveLength(1);
    expect((await i((db) => hentAbonnement(db, org)))!.discountPercent).toBe(25);
  });

  it("tar vare på modulene med prisen de ble solgt til", async () => {
    const org = await nyOrg(100);
    const a = await i((db) =>
      settAbonnement(db, org, {
        moduler: [{ key: "internkontroll", price: 9000 }],
        discountPercent: 0,
      }),
    );
    expect(a!.moduler).toEqual([{ key: "internkontroll", price: 9000 }]);
  });

  it("lar seg åpne selv om modul-JSON er ødelagt", async () => {
    const org = await nyOrg(100);
    await i((db) => settAbonnement(db, org, { moduler: [], discountPercent: 0 }));
    await eier.query("UPDATE platform_contracts SET modules = 'ikke json' WHERE org_id = $1", [org]);

    const a = await i((db) => hentAbonnement(db, org));
    expect(a!.moduler).toEqual([]);
  });

  it("gir null når kunden ikke har noen avtale", async () => {
    const org = await nyOrg(100);
    expect(await i((db) => hentAbonnement(db, org))).toBeNull();
    await i((db) => slettAbonnement(db, org));
    expect(await i((db) => hentAbonnement(db, org))).toBeNull();
  });
});

// ── Onboarding ──────────────────────────────────────────────────────────────────────────

describe("onboarding", () => {
  it("teller IKKE plattformbrukere som kundens styre", async () => {
    const org = await nyOrg(50);
    await nyBruker(org, "member");
    await nyBruker(org, "superadmin");
    await nyBruker(org, "kontoansvarlig");

    const o = await i((db) => hentOnboarding(db, org));
    const styret = o.punkter.find((p) => p.nokkel === "styret")!;
    // Tre medlemskap, men bare én ekte bruker — punktet skal IKKE være grønt.
    expect(styret.ok).toBe(false);
    expect(styret.detalj).toBe("1 bruker");
  });

  it("blir grønt på styret når to ekte brukere er inne", async () => {
    const org = await nyOrg(50);
    await nyBruker(org);
    await nyBruker(org);

    const o = await i((db) => hentOnboarding(db, org));
    expect(o.punkter.find((p) => p.nokkel === "styret")!.ok).toBe(true);
  });

  it("regner prosent av antall punkter", async () => {
    const org = await nyOrg(null);
    const o = await i((db) => hentOnboarding(db, org));
    // En helt tom kunde har ingenting på plass.
    expect(o.prosent).toBe(0);
    expect(o.punkter.every((p) => !p.ok)).toBe(true);
  });

  it("teller andeler som satt så snart tallet finnes", async () => {
    const org = await nyOrg(84);
    const o = await i((db) => hentOnboarding(db, org));
    const andeler = o.punkter.find((p) => p.nokkel === "andeler")!;
    expect(andeler.ok).toBe(true);
    expect(andeler.detalj).toBe("84 andeler");
  });

  it("regner en tom «om bygget» som ikke utfylt", async () => {
    const org = await nyOrg(10);
    for (const verdi of ["", "   ", "{}"]) {
      await eier.query("UPDATE organizations SET building_info = $2 WHERE id = $1", [org, verdi]);
      const o = await i((db) => hentOnboarding(db, org));
      expect(o.punkter.find((p) => p.nokkel === "om_bygget")!.ok).toBe(false);
    }
    await eier.query("UPDATE organizations SET building_info = $2 WHERE id = $1", [
      org,
      '{"byggeaar":1972}',
    ]);
    const o = await i((db) => hentOnboarding(db, org));
    expect(o.punkter.find((p) => p.nokkel === "om_bygget")!.ok).toBe(true);
  });
});

// ── Moduler og tilknytning ──────────────────────────────────────────────────────────────

describe("moduler", () => {
  it("lagrer en eksplisitt liste som blir fasit", async () => {
    const org = await nyOrg();
    await i((db) => settModuler(db, org, ["tasks", "avvik", "parkering"]));
    const d = await i((db) => hentDetalj(db, org));
    expect(d.moduler).toContain("parkering");
    // Internkontroll er av-som-standard og ble ikke valgt.
    expect(d.moduler).not.toContain("internkontroll");
  });

  it("fjerner duplikater", async () => {
    const org = await nyOrg();
    await i((db) => settModuler(db, org, ["tasks", "tasks", "avvik"]));
    const { rows } = await eier.query<{ m: string }>(
      "SELECT enabled_modules AS m FROM organizations WHERE id = $1",
      [org],
    );
    expect(JSON.parse(rows[0]!.m)).toEqual(["tasks", "avvik"]);
  });
});

describe("tilknytning", () => {
  it("rydder bort feltene som ikke gjelder når typen endres", async () => {
    const org = await nyOrg();
    const lag = await nyBbl("Vestbo");

    await i((db) =>
      settTilknytning(db, org, {
        affiliationType: "tilknyttet",
        bblId: lag,
        managerType: "ekstern",
        managerName: "Regnskap AS",
        managerOrgNr: "938765432",
      }),
    );

    // Bytt til selvadministrert og frittstående: byrået og laget skal bort.
    const etter = await i((db) =>
      settTilknytning(db, org, {
        affiliationType: "frittstaende",
        managerType: "selvadministrert",
      }),
    );
    expect(etter.bblId).toBeNull();
    expect(etter.managerName).toBeNull();
    expect(etter.managerOrgNr).toBeNull();
    expect(etter.managerBblId).toBeNull();
  });

  it("henter navnet på laget til visningen", async () => {
    const org = await nyOrg();
    const lag = await nyBbl("Bergen og Omegn BBL");
    await i((db) => settTilknytning(db, org, { affiliationType: "tilknyttet", bblId: lag }));

    const d = await i((db) => hentDetalj(db, org));
    expect(d.org.bblNavn).toBe("Bergen og Omegn BBL");
  });
});

// ── Boligbyggelag ───────────────────────────────────────────────────────────────────────

describe("boligbyggelag", () => {
  it("normaliserer org.nr, så samme lag ikke kan registreres to ganger", async () => {
    const a = await i((db) => bblLag.opprett(db, { name: "Vestbo", orgNr: "938 765 432", active: true }));
    ryddBbl.push(a.id);
    expect(a.orgNr).toBe("938765432");

    await expect(
      i((db) => bblLag.opprett(db, { name: "Vestbo igjen", orgNr: "938765432", active: true })),
    ).rejects.toMatchObject({ status: 400 } satisfies Partial<ApiFeil>);
  });

  it("teller en kunde ÉN gang selv om laget både er tilknytning og forretningsfører", async () => {
    const lag = await nyBbl("Vestbo");
    const org = await nyOrg();
    await i((db) =>
      settTilknytning(db, org, {
        affiliationType: "tilknyttet",
        bblId: lag,
        managerType: "bbl",
        managerBblId: lag,
      }),
    );

    const alle = await i((db) => bblLag.hentAlle(db));
    expect(alle.find((b) => b.id === lag)!.antallKunder).toBe(1);
  });

  it("teller forretningsførsel alene som bruk", async () => {
    const lag = await nyBbl("Vestbo");
    const org = await nyOrg();
    await i((db) => settTilknytning(db, org, { managerType: "bbl", managerBblId: lag }));

    const alle = await i((db) => bblLag.hentAlle(db));
    expect(alle.find((b) => b.id === lag)!.antallKunder).toBe(1);
  });

  it("nekter å slette et lag som er i bruk — historikken skal overleve", async () => {
    const lag = await nyBbl("Vestbo");
    const org = await nyOrg();
    await i((db) => settTilknytning(db, org, { affiliationType: "tilknyttet", bblId: lag }));

    await expect(i((db) => bblLag.slett(db, lag))).rejects.toMatchObject({ status: 400 });
  });

  it("sletter et lag ingen bruker", async () => {
    const lag = await nyBbl("Feilregistrert");
    await i((db) => bblLag.slett(db, lag));
    const { rows } = await eier.query("SELECT id FROM bbl WHERE id = $1", [lag]);
    expect(rows).toHaveLength(0);
  });
});

// ── Prismodell ──────────────────────────────────────────────────────────────────────────

describe("prismodell", () => {
  it("oppretter singleton-raden ved første oppslag", async () => {
    const m = await i((db) => hentPrismodell(db));
    expect(m.gulvpris).toBeGreaterThan(0);
    expect(m.trinn.length).toBeGreaterThan(0);

    const { rows } = await eier.query("SELECT id FROM pricing_config");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("default");
  });

  it("lagrer og leser tilbake endrede satser", async () => {
    const forrige = await i((db) => hentPrismodell(db));
    const aktor = { navn: "Kundedetaljtest", brukerId: null };
    try {
      const ny = await i((db) =>
        settPrismodell(
          db,
          {
            gulvpris: 9500,
            trinn: [{ fra: 1, til: 100, sats: 200 }],
            modulpriser: { parkering: 7000 },
          },
          aktor,
        ),
      );
      expect(ny.gulvpris).toBe(9500);
      expect(ny.trinn).toEqual([{ fra: 1, til: 100, sats: 200 }]);
      expect(ny.modulpriser).toEqual({ parkering: 7000 });
    } finally {
      // Raden er en singleton og deles med resten av testbasen — sett den tilbake, og
      // fjern versjonsradene lagringene la igjen (hver lagring blir en versjon).
      await i((db) =>
        settPrismodell(
          db,
          {
            gulvpris: forrige.gulvpris,
            trinn: forrige.trinn,
            modulpriser: forrige.modulpriser,
          },
          aktor,
        ),
      );
      await eier.query("DELETE FROM pricing_versions WHERE created_by = $1", [aktor.navn]);
    }
  });
});
