/**
 * Avtalehistorikken (BL-182) — ingen v1-forgjenger. Bygget fra `lib/avtalehistorikk.ts`.
 *
 * Tyngdepunktet er at historikken aldri skrives om bakover: en endring gjelder fra i dag, en
 * sletting avslutter i dag, og det som ble avtalt i fjor står. Pluss at engangsutfyllingen er
 * idempotent — den kjøres ved hver oppstart.
 *
 * `forAvtaleversjon` testes direkte med `naa` for å styre «i dag»; ett kall går gjennom
 * `settAbonnement`/`slettAbonnement` for å vise at abonnementet faktisk skriver hit.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import {
  avsluttAvtalehistorikk,
  avtaltArssum,
  forAvtaleversjon,
  fyllAvtalehistorikk,
} from "../src/lib/avtalehistorikk";
import { settAbonnement, slettAbonnement } from "../src/lib/kundedetalj";
import { osloDato } from "../src/lib/idag";

let eierPool: Pool;
const ryddOrg: string[] = [];

beforeAll(() => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
});

afterAll(async () => {
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  // platform_contract_versions følger organisasjonen (CASCADE).
  for (const id of ryddOrg.splice(0)) {
    await eierPool.query("DELETE FROM platform_contracts WHERE org_id = $1", [id]);
    await eierPool.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

const i = <T>(fn: (db: Parameters<Parameters<typeof withoutRls>[1]>[0]) => Promise<T>) =>
  withoutRls("plattformpanel", fn);

async function nyOrg(): Promise<string> {
  const id = `ah-${randomUUID()}`;
  await eierPool.query(
    "INSERT INTO organizations (id, name, slug, active, unit_count) VALUES ($1,'Historikklaget',$1,true,100)",
    [id],
  );
  ryddOrg.push(id);
  return id;
}

async function versjoner(orgId: string) {
  const { rows } = await eierPool.query(
    `SELECT annual_amount AS belop, discount_percent AS rabatt,
            to_char(valid_from, 'YYYY-MM-DD') AS fra, to_char(valid_to, 'YYYY-MM-DD') AS til
     FROM platform_contract_versions WHERE org_id = $1 ORDER BY valid_from`,
    [orgId],
  );
  return rows as Array<{ belop: number; rabatt: number; fra: string; til: string | null }>;
}

const avtale = (over: Partial<Parameters<typeof forAvtaleversjon>[2]> = {}) => ({
  baseFee: 20_000,
  annualFee: null,
  modules: JSON.stringify([{ key: "internkontroll", price: 10_000 }]),
  discountPercent: 0,
  startDate: null,
  endDate: null,
  ...over,
});

const dag = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("avtaltArssum", () => {
  it("er grunnpakke + moduler etter rabatt, og tåler ødelagt JSON", () => {
    expect(avtaltArssum(avtale({ discountPercent: 50 }))).toBe(15_000);
    expect(avtaltArssum(avtale({ modules: "ikke json" }))).toBe(20_000);
  });
});

describe("forAvtaleversjon", () => {
  it("første versjon gjelder fra startdatoen, også når den ligger bak oss", async () => {
    const org = await nyOrg();
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2026-03-01" }), dag("2026-10-01")));
    expect(await versjoner(org)).toEqual([{ belop: 30_000, rabatt: 0, fra: "2026-03-01", til: null }]);
  });

  it("en endring gjelder fra i dag og avslutter den forrige — bakover skrives ikke om", async () => {
    const org = await nyOrg();
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2026-01-01", discountPercent: 100 }), dag("2026-01-01")));
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2026-01-01" }), dag("2026-06-15")));
    expect(await versjoner(org)).toEqual([
      { belop: 0, rabatt: 100, fra: "2026-01-01", til: "2026-06-15" },
      { belop: 30_000, rabatt: 0, fra: "2026-06-15", til: null },
    ]);
  });

  it("skriver ingenting når bare notat eller fornyelsesdato endres", async () => {
    const org = await nyOrg();
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2026-01-01" }), dag("2026-02-01")));
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2026-01-01" }), dag("2026-05-01")));
    expect(await versjoner(org)).toHaveLength(1);
  });

  it("sluttdatoen er siste gyldige dag — valid_to er dagen etter", async () => {
    const org = await nyOrg();
    await i((db) =>
      forAvtaleversjon(db, org, avtale({ startDate: "2026-01-01", endDate: "2026-12-31" }), dag("2026-01-01")),
    );
    expect((await versjoner(org))[0]!.til).toBe("2027-01-01");
  });

  it("en ny avtale som starter fram i tid, erstatter versjonen som ennå ikke har trådt i kraft", async () => {
    const org = await nyOrg();
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2027-01-01" }), dag("2026-10-01")));
    await i((db) =>
      forAvtaleversjon(db, org, avtale({ startDate: "2027-01-01", discountPercent: 20 }), dag("2026-10-02")),
    );
    expect(await versjoner(org)).toEqual([{ belop: 24_000, rabatt: 20, fra: "2027-01-01", til: null }]);
  });
});

describe("sletting", () => {
  it("avslutter den gjeldende i dag og fjerner det som ikke har startet", async () => {
    const org = await nyOrg();
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2026-01-01" }), dag("2026-01-01")));
    await i((db) => forAvtaleversjon(db, org, avtale({ startDate: "2026-01-01", discountPercent: 10 }), dag("2026-12-01")));
    await i((db) => avsluttAvtalehistorikk(db, org, dag("2026-09-01")));
    expect(await versjoner(org)).toEqual([{ belop: 30_000, rabatt: 0, fra: "2026-01-01", til: "2026-09-01" }]);
  });
});

describe("abonnementet skriver historikken", () => {
  it("settAbonnement fører versjonen, slettAbonnement avslutter den i dag", async () => {
    const org = await nyOrg();
    await i((db) =>
      settAbonnement(db, org, { moduler: [{ key: "internkontroll", price: 5_000 }], discountPercent: 0, startDate: "2026-01-01" }),
    );
    const [v] = await versjoner(org);
    // 100 andeler: 50×280 + 50×180 = 23 000, pluss modulen.
    expect(v).toEqual({ belop: 28_000, rabatt: 0, fra: "2026-01-01", til: null });

    await i((db) => slettAbonnement(db, org));
    const etter = await versjoner(org);
    expect(etter).toHaveLength(1);
    expect(etter[0]!.til).toBe(osloDato(new Date()));
  });
});

describe("engangsutfylling", () => {
  it("fører eksisterende avtaler fra startdato, og bare én gang", async () => {
    const org = await nyOrg();
    await eierPool.query(
      `INSERT INTO platform_contracts (id, org_id, base_fee, modules, discount_percent, start_date)
       VALUES ($1, $2, 10000, '[{"key":"arshjul","price":2500}]', 0, '2026-04-01')`,
      [randomUUID(), org],
    );
    expect(await withoutRls("migrasjon", (db) => fyllAvtalehistorikk(db, org))).toBe(1);
    expect(await withoutRls("migrasjon", (db) => fyllAvtalehistorikk(db, org))).toBe(0);
    expect(await versjoner(org)).toEqual([{ belop: 12_500, rabatt: 0, fra: "2026-04-01", til: null }]);
  });

  it("bruker registreringsdatoen når startdato mangler", async () => {
    const org = await nyOrg();
    await eierPool.query(
      `INSERT INTO platform_contracts (id, org_id, base_fee, discount_percent, created_at)
       VALUES ($1, $2, 8000, 100, '2026-05-20T10:00:00Z')`,
      [randomUUID(), org],
    );
    await withoutRls("migrasjon", (db) => fyllAvtalehistorikk(db, org));
    expect(await versjoner(org)).toEqual([{ belop: 0, rabatt: 100, fra: "2026-05-20", til: null }]);
  });
});
