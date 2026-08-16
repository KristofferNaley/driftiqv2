/**
 * Globalt søk — `hentGlobaltSok` i src/lib/sok.ts.
 *
 * Ingen v1-motpart: v1 hadde ikke globalt søk. Tyngdepunktet er de tre tingene som feiler
 * STILLE hvis de ryker: tenantisolasjonen (org Bs rader i org As søk), modulgaten (treff
 * fra en modul kunden ikke har) og norsken (sammensatte ord som «vannlekkasje» dekomponeres
 * ikke av snowball — ILIKE-grenen bærer dem).
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { hentGlobaltSok } from "../src/lib/sok";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];

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
    await eier.query("DELETE FROM deviations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM log_entries WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

/** Org med valgfri modulliste. `null` = standardsettet (alt på). */
async function nyOrg(moduler: string[] | null = null): Promise<string> {
  const id = `sok-${randomUUID()}`;
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active, enabled_modules) VALUES ($1,$2,$3,true,$4)",
    [id, "Søkelaget", id, moduler === null ? null : JSON.stringify(moduler)],
  );
  ryddOrg.push(id);
  return id;
}

async function nyttAvvik(orgId: string, tittel: string, beskrivelse: string | null = null, nummer = 1) {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO deviations (id, org_id, number, title, description, category, severity, status, reported_by, reported_at)
     VALUES ($1,$2,$3,$4,$5,'annet','lav','ny','Kari',now())`,
    [id, orgId, nummer, tittel, beskrivelse],
  );
  return id;
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

describe("hentGlobaltSok", () => {
  it("treffer på tittel og beskrivelse", async () => {
    const org = await nyOrg();
    await nyttAvvik(org, "Lekkasje i garasjen", "Vann renner fra taket ved plass 12");

    const paTittel = await i(org, (db) => hentGlobaltSok(db, org, "garasjen"));
    expect(paTittel.map((t) => t.tittel)).toContain("Lekkasje i garasjen");

    const paBeskrivelse = await i(org, (db) => hentGlobaltSok(db, org, "taket"));
    expect(paBeskrivelse.map((t) => t.tittel)).toContain("Lekkasje i garasjen");
  });

  it("treffer prefiks mens man skriver («garasj» → «garasjen»)", async () => {
    const org = await nyOrg();
    await nyttAvvik(org, "Lekkasje i garasjen");
    const treff = await i(org, (db) => hentGlobaltSok(db, org, "garasj"));
    expect(treff.map((t) => t.tittel)).toContain("Lekkasje i garasjen");
  });

  /**
   * Norsken: snowball dekomponerer ikke sammensatte ord, så dette treffet kan BARE komme
   * fra ILIKE-grenen. Ryker denne, har noen «ryddet bort» ILIKE for ytelse.
   */
  it("treffer inne i sammensatte ord («lekkasje» → «vannlekkasje»)", async () => {
    const org = await nyOrg();
    await nyttAvvik(org, "Vannlekkasje i kjeller");
    const treff = await i(org, (db) => hentGlobaltSok(db, org, "lekkasje"));
    expect(treff.map((t) => t.tittel)).toContain("Vannlekkasje i kjeller");
  });

  it("treffer avvik på nummer («#21» og «21»)", async () => {
    const org = await nyOrg();
    await nyttAvvik(org, "Knust vindu", null, 21);
    for (const q of ["#21", "21"]) {
      const treff = await i(org, (db) => hentGlobaltSok(db, org, q));
      expect(treff.map((t) => t.tittel)).toContain("Knust vindu");
      expect(treff.find((t) => t.tittel === "Knust vindu")?.nummer).toBe(21);
    }
  });

  it("lekker aldri en annen orgs rader", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await nyttAvvik(a, "Lekkasje hos A");
    await nyttAvvik(b, "Lekkasje hos B");

    const treff = await i(a, (db) => hentGlobaltSok(db, a, "lekkasje"));
    expect(treff.map((t) => t.tittel)).toContain("Lekkasje hos A");
    expect(treff.map((t) => t.tittel)).not.toContain("Lekkasje hos B");
  });

  it("hopper over moduler kunden ikke har", async () => {
    // Kun avvik aktivert. Driftsloggraden matcher søket, men modulen er av — null treff.
    const org = await nyOrg(["avvik"]);
    await eier.query(
      `INSERT INTO log_entries (id, org_id, title, description, entry_date, created_by)
       VALUES ($1,$2,'Lekkasje notert i loggen','',current_date,'Kari')`,
      [randomUUID(), org],
    );
    await nyttAvvik(org, "Lekkasje i garasjen");

    const treff = await i(org, (db) => hentGlobaltSok(db, org, "lekkasje"));
    expect(treff.map((t) => t.modul)).toContain("avvik");
    expect(treff.map((t) => t.modul)).not.toContain("driftslogg");
  });

  it("tåler spesialtegn uten å kaste («heis & port!»)", async () => {
    const org = await nyOrg();
    await nyttAvvik(org, "Heis og port kontrollert");
    // to_tsquery kaster på «&» og «!» — saniteringen skal gjøre dette til et gyldig søk.
    const treff = await i(org, (db) => hentGlobaltSok(db, org, "heis & port!"));
    expect(Array.isArray(treff)).toBe(true);
  });

  it("grupperbart svar: treff bærer modulen sin", async () => {
    const org = await nyOrg();
    await nyttAvvik(org, "Lekkasje i garasjen");
    await eier.query(
      "INSERT INTO vendors (id, org_id, name, notes) VALUES ($1,$2,'Lekkasjespesialisten AS',null)",
      [randomUUID(), org],
    );

    const treff = await i(org, (db) => hentGlobaltSok(db, org, "lekkasje"));
    const moduler = new Set(treff.map((t) => t.modul));
    expect(moduler.has("avvik")).toBe(true);
    expect(moduler.has("leverandorer")).toBe(true);
  });
});
