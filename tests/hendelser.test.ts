/**
 * Hendelsesloggen — ny i v2, ingen v1-fasit. Tyngdepunktet er isolasjonen (org A skal
 * aldri se org Bs hendelser) og navneregelen: nåværende navn vinner når raden har en id,
 * snapshotet er reserven — samme regel som driftsloggen.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import {
  HENDELSER_OPPBEVARING_DAGER,
  hentHendelser,
  loggHendelse,
  slettGamleHendelser,
} from "../src/lib/hendelser";
import { aktorFor, anonymAktor } from "../src/lib/aktor";

const KARI = anonymAktor("Kari");

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
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `hendelser-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id, "Hendelseslaget", id,
  ]);
  ryddOrg.push(id);
  return id;
}

async function nyBruker(navn: string): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,$2,$3,'member',true,true,now(),now())`,
    [id, navn, `${id}@driftiq.test`],
  );
  ryddBruker.push(id);
  return { id, name: navn };
}

const hendelse = { modul: "org" as const, entitet: "bruker", hendelse: "Deaktiverte kontoen" };

describe("skriving", () => {
  it("lagrer aktørens navn og id", async () => {
    const org = await nyOrg();
    const bruker = await nyBruker("Ola Nordmann");
    await withOrg(org, (db) => loggHendelse(db, org, aktorFor(bruker), hendelse));
    const { hendelser, antall } = await withOrg(org, (db) => hentHendelser(db, org));
    expect(antall).toBe(1);
    expect(hendelser[0]!.actorName).toBe("Ola Nordmann");
    expect(hendelser[0]!.actorUserId).toBe(bruker.id);
    expect(hendelser[0]!.module).toBe("org");
  });

  it("godtar anonym aktør uten id", async () => {
    const org = await nyOrg();
    await withOrg(org, (db) => loggHendelse(db, org, KARI, hendelse));
    const { hendelser } = await withOrg(org, (db) => hentHendelser(db, org));
    expect(hendelser[0]!.actorName).toBe("Kari");
    expect(hendelser[0]!.actorUserId).toBeNull();
  });
});

describe("navneregelen", () => {
  it("nåværende navn vinner over snapshotet når raden har en id", async () => {
    const org = await nyOrg();
    const bruker = await nyBruker("Kari Hansen");
    await withOrg(org, (db) => loggHendelse(db, org, aktorFor(bruker), hendelse));
    await eier.query("UPDATE users SET name = 'Kari Olsen' WHERE id = $1", [bruker.id]);
    const { hendelser } = await withOrg(org, (db) => hentHendelser(db, org));
    expect(hendelser[0]!.actorName).toBe("Kari Olsen");
  });

  it("snapshotet står igjen når brukeren slettes", async () => {
    const org = await nyOrg();
    const bruker = await nyBruker("Per Persen");
    await withOrg(org, (db) => loggHendelse(db, org, aktorFor(bruker), hendelse));
    await eier.query("DELETE FROM users WHERE id = $1", [bruker.id]);
    ryddBruker.length = 0;
    const { hendelser } = await withOrg(org, (db) => hentHendelser(db, org));
    expect(hendelser[0]!.actorName).toBe("Per Persen");
    expect(hendelser[0]!.actorUserId).toBeNull();
  });
});

describe("isolasjon", () => {
  it("org A ser aldri org Bs hendelser", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await withOrg(a, (db) => loggHendelse(db, a, KARI, hendelse));
    await withOrg(b, (db) => loggHendelse(db, b, KARI, hendelse));
    const { hendelser, antall } = await withOrg(a, (db) => hentHendelser(db, a));
    expect(antall).toBe(1);
    expect(hendelser.every((h) => h.orgId === a)).toBe(true);
  });
});

describe("filter", () => {
  it("filtrerer på modul og aktør", async () => {
    const org = await nyOrg();
    const bruker = await nyBruker("Gro");
    await withOrg(org, (db) => loggHendelse(db, org, aktorFor(bruker), hendelse));
    await withOrg(org, (db) =>
      loggHendelse(db, org, KARI, { modul: "dokumentarkiv", entitet: "dokument", hendelse: "Slettet «HMS-plan.pdf»" }),
    );
    const perModul = await withOrg(org, (db) => hentHendelser(db, org, { modul: "dokumentarkiv" }));
    expect(perModul.antall).toBe(1);
    expect(perModul.hendelser[0]!.entity).toBe("dokument");
    const perAktor = await withOrg(org, (db) => hentHendelser(db, org, { aktorUserId: bruker.id }));
    expect(perAktor.antall).toBe(1);
    expect(perAktor.hendelser[0]!.actorUserId).toBe(bruker.id);
  });
});

describe("rydding", () => {
  it("sletter kun rader eldre enn oppbevaringstiden", async () => {
    const org = await nyOrg();
    await withOrg(org, (db) => loggHendelse(db, org, KARI, hendelse));
    const gammelId = randomUUID();
    await eier.query(
      `INSERT INTO audit_events (id, org_id, actor_name, occurred_at, module, entity, event)
       VALUES ($1,$2,'Kari', now() - ($3 || ' days')::interval, 'org','bruker','Gammel rad')`,
      [gammelId, org, String(HENDELSER_OPPBEVARING_DAGER + 1)],
    );
    const slettet = await withOrg(org, (db) => slettGamleHendelser(db, new Date()));
    expect(slettet).toBe(1);
    const { antall, hendelser } = await withOrg(org, (db) => hentHendelser(db, org));
    expect(antall).toBe(1);
    expect(hendelser[0]!.event).toBe("Deaktiverte kontoen");
  });
});
