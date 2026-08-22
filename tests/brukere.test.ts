/**
 * Brukere og tilgangsstyring — sperrene som hindrer et styre i å låse seg ute, og
 * admin-nullstilling av tofaktor. Ingen direkte v1-motpart: v1 hadde bare
 * siste-admin-sperren, og tofaktor fantes ikke der.
 *
 * Tyngdepunktet: (1) ingen kan endre sitt EGET tilgangsnivå, uansett hvor mange
 * kontoadmins laget har — det er alltid en annen som gjør det; (2) siste kontoadmin kan
 * verken degraderes eller fjernes; (3) tofaktor-nullstilling er avgrenset til egen org,
 * virker aldri på en selv, og sletter både hemmeligheten og flagget.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { ApiFeil } from "../src/lib/api";
import { endreMedlemskap, fjernFraOrg, resettTofaktor } from "../src/lib/brukere";
import type { Aktor } from "../src/lib/aktor";

/** Den innloggede som aktør. Selvsperrene sammenligner på `brukerId`, navnet er pynt her. */
const som = (id: string): Aktor => ({ navn: "Testbruker", brukerId: id });

let eierPool: Pool;
let eier: PoolClient;

const ryddOrg: string[] = [];
const ryddBruker: string[] = [];

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
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    // `two_factor` ryddes av ON DELETE CASCADE fra users.
    await eier.query("DELETE FROM user_org_memberships WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `brukere-${randomUUID()}`;
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active) VALUES ($1, $2, $3, true)",
    [id, "Testlaget", id],
  );
  ryddOrg.push(id);
  return id;
}

async function nyBruker(): Promise<string> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, 'member', true, true, now(), now())`,
    [id, id.slice(0, 8), `${id}@driftiq.test`],
  );
  ryddBruker.push(id);
  return id;
}

async function medlem(brukerId: string, orgId: string, nivaa: string) {
  await eier.query(
    "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,$4)",
    [randomUUID(), brukerId, orgId, nivaa],
  );
}

async function nivaaFor(brukerId: string, orgId: string): Promise<string | undefined> {
  const { rows } = await eier.query<{ role: string }>(
    "SELECT role FROM user_org_memberships WHERE user_id = $1 AND org_id = $2",
    [brukerId, orgId],
  );
  return rows[0]?.role;
}

/** Fanger ApiFeil slik ruta ville gjort, og returnerer den — eller null om kallet gikk. */
async function feiler(fn: () => Promise<unknown>): Promise<ApiFeil | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof ApiFeil) return e;
    throw e;
  }
}

describe("eget tilgangsnivå", () => {
  it("kan ikke endres av en selv — heller ikke med en annen kontoadmin til stede", async () => {
    const org = await nyOrg();
    const a = await nyBruker();
    const b = await nyBruker();
    await medlem(a, org, "orgadmin");
    await medlem(b, org, "orgadmin");

    const feil = await withOrg(org, (db) =>
      feiler(() => endreMedlemskap(db, org, a, { role: "redigering" }, som(a))),
    );
    expect(feil?.status).toBe(400);
    expect(feil?.message).toMatch(/eget tilgangsnivå/);
    expect(await nivaaFor(a, org)).toBe("orgadmin");
  });

  it("navn og tittel kan endres på en selv — og et UENDRET nivå i kroppen avvises ikke", async () => {
    const org = await nyOrg();
    const a = await nyBruker();
    await medlem(a, org, "orgadmin");

    // UI-et sender hele skjemaet, også nivået man allerede har. Sperren skal bare slå til
    // når nivået faktisk ENDRES — ellers kunne ingen rette sitt eget navn.
    await withOrg(org, (db) =>
      endreMedlemskap(db, org, a, { name: "Nytt Navn", title: "Styreleder", role: "orgadmin" }, som(a)),
    );
    const { rows } = await eier.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [a]);
    expect(rows[0]?.name).toBe("Nytt Navn");
    expect(await nivaaFor(a, org)).toBe("orgadmin");
  });

  it("en ANNEN kontoadmin kan degradere når laget har flere", async () => {
    const org = await nyOrg();
    const a = await nyBruker();
    const b = await nyBruker();
    await medlem(a, org, "orgadmin");
    await medlem(b, org, "orgadmin");

    await withOrg(org, (db) => endreMedlemskap(db, org, a, { role: "visning" }, som(b)));
    expect(await nivaaFor(a, org)).toBe("visning");
  });
});

describe("siste kontoadmin", () => {
  it("kan ikke degraderes — heller ikke av en annen", async () => {
    const org = await nyOrg();
    const a = await nyBruker();
    const b = await nyBruker();
    await medlem(a, org, "orgadmin");
    await medlem(b, org, "redigering");

    const feil = await withOrg(org, (db) =>
      feiler(() => endreMedlemskap(db, org, a, { role: "redigering" }, som(b))),
    );
    expect(feil?.status).toBe(400);
    expect(feil?.message).toMatch(/minst én administrator/);
    expect(await nivaaFor(a, org)).toBe("orgadmin");
  });

  it("kan ikke fjernes", async () => {
    const org = await nyOrg();
    const a = await nyBruker();
    await medlem(a, org, "orgadmin");

    const feil = await withOrg(org, (db) => feiler(() => fjernFraOrg(db, org, a, som(a))));
    expect(feil?.status).toBe(400);
    expect(await nivaaFor(a, org)).toBe("orgadmin");
  });
});

describe("tofaktor-nullstilling", () => {
  async function medTofaktor(brukerId: string) {
    await eier.query("UPDATE users SET two_factor_enabled = true WHERE id = $1", [brukerId]);
    await eier.query(
      "INSERT INTO two_factor (id, user_id, secret, backup_codes) VALUES ($1, $2, 'hemmelig', 'koder')",
      [randomUUID(), brukerId],
    );
  }

  async function tofaktorTilstand(brukerId: string) {
    const flagg = await eier.query<{ two_factor_enabled: boolean }>(
      "SELECT two_factor_enabled FROM users WHERE id = $1",
      [brukerId],
    );
    const rader = await eier.query("SELECT 1 FROM two_factor WHERE user_id = $1", [brukerId]);
    return { flagg: flagg.rows[0]?.two_factor_enabled, rader: rader.rowCount ?? 0 };
  }

  it("sletter hemmeligheten og flagget for en annen bruker i org-en", async () => {
    const org = await nyOrg();
    const admin = await nyBruker();
    const b = await nyBruker();
    await medlem(admin, org, "orgadmin");
    await medlem(b, org, "redigering");
    await medTofaktor(b);

    await withOrg(org, (db) => resettTofaktor(db, org, b, som(admin)));

    const etter = await tofaktorTilstand(b);
    expect(etter.flagg).toBe(false);
    expect(etter.rader).toBe(0);
  });

  it("virker aldri på en selv — egen tofaktor krever passordbeviset i profilen", async () => {
    const org = await nyOrg();
    const admin = await nyBruker();
    await medlem(admin, org, "orgadmin");
    await medTofaktor(admin);

    const feil = await withOrg(org, (db) =>
      feiler(() => resettTofaktor(db, org, admin, som(admin))),
    );
    expect(feil?.status).toBe(400);
    expect((await tofaktorTilstand(admin)).rader).toBe(1);
  });

  it("når ikke brukere utenfor org-en", async () => {
    // c har tofaktor og sitter i en ANNEN org. 404 her er tenantsperren — `two_factor`
    // står i UNNTATT og har ingen RLS, så medlemskapssjekken er det eneste vernet.
    const orgA = await nyOrg();
    const orgB = await nyOrg();
    const admin = await nyBruker();
    const c = await nyBruker();
    await medlem(admin, orgA, "orgadmin");
    await medlem(c, orgB, "orgadmin");
    await medTofaktor(c);

    const feil = await withOrg(orgA, (db) => feiler(() => resettTofaktor(db, orgA, c, som(admin))));
    expect(feil?.status).toBe(404);
    expect((await tofaktorTilstand(c)).rader).toBe(1);
  });
});
