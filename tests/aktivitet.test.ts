/**
 * «Min aktivitet» — id først, navn bare som reserve.
 *
 * Hele risikoen ligger i den rekkefølgen. Har raden en `*_user_id`, er den svaret, også når
 * navnet på raden er et annet fordi personen har byttet navn siden. Bare når id-en mangler —
 * QR-skjemaet er anonymt, og rader skrevet før kolonnene fantes har ingen — sammenlignes navn,
 * og da er et for løst treff en annens arbeid i din liste, mens et for strengt er en tom side.
 * Testene under fester begge kantene, og at tenantisolasjonen holder i begge tilfeller.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { hentMinAktivitet } from "../src/lib/aktivitet";

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
    await eier.query(
      "DELETE FROM completions WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query(
      `DELETE FROM deviation_treatments WHERE deviation_id IN
         (SELECT id FROM deviations WHERE org_id = $1)`,
      [id],
    );
    await eier.query("DELETE FROM deviations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM log_entries WHERE org_id = $1", [id]);
    await eier.query(
      "DELETE FROM hms_goal_approvals WHERE goal_id IN (SELECT id FROM hms_goals WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM hms_goals WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<{ orgId: string; vendorId: string }> {
  const orgId = `akt-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId,
    "Aktivitetslaget",
    orgId,
  ]);
  ryddOrg.push(orgId);

  const vendorId = randomUUID();
  await eier.query(
    "INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Vaktmester',true)",
    [vendorId, orgId],
  );
  return { orgId, vendorId };
}

async function nyBruker(navn: string): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  await eier.query("INSERT INTO users (id, name, email, role, active) VALUES ($1,$2,$3,'member',true)", [
    id,
    navn,
    `${id}@test.invalid`,
  ]);
  ryddBruker.push(id);
  return { id, name: navn };
}

/**
 * Utkvittering av en oppgave. `brukerId` er valgfri MED VILJE: rader uten id finnes for godt
 * (QR-skjemaet er anonymt), og det er nettopp de reserven skal fange.
 */
async function nyUtkvittering(
  orgId: string,
  vendorId: string,
  navn: string,
  nar = new Date(),
  brukerId: string | null = null,
) {
  const taskId = randomUUID();
  await eier.query(
    `INSERT INTO tasks (id, org_id, vendor_id, title, frequency, active)
     VALUES ($1,$2,$3,'Legionellakontroll','annual',true)`,
    [taskId, orgId, vendorId],
  );
  await eier.query(
    `INSERT INTO completions (id, task_id, completed_at, completed_by, completed_by_user_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), taskId, nar, navn, brukerId],
  );
  return taskId;
}

async function nyttAvvik(
  orgId: string,
  navn: string,
  nar = new Date(),
  brukerId: string | null = null,
) {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO deviations (id, org_id, title, status, reported_by, reported_by_user_id, reported_at)
     VALUES ($1,$2,'Vann i kjeller','ny',$3,$4,$5)`,
    [id, orgId, navn, brukerId, nar],
  );
  return id;
}

async function nyLoggforing(
  orgId: string,
  navn: string,
  dato = new Date(),
  brukerId: string | null = null,
) {
  await eier.query(
    `INSERT INTO log_entries (id, org_id, title, entry_date, created_by, created_by_user_id)
     VALUES ($1,$2,'Byttet lyspære i oppgang B',$3,$4,$5)`,
    [randomUUID(), orgId, dato.toISOString().slice(0, 10), navn, brukerId],
  );
}

async function nySignatur(orgId: string, brukerId: string, aar: number) {
  const goalId = randomUUID();
  await eier.query(
    "INSERT INTO hms_goals (id, org_id, year, goal_text) VALUES ($1,$2,$3,'Ingen skader')",
    [goalId, orgId, aar],
  );
  await eier.query(
    "INSERT INTO hms_goal_approvals (id, goal_id, user_id) VALUES ($1,$2,$3)",
    [randomUUID(), goalId, brukerId],
  );
  return goalId;
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

const dagerSiden = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("min aktivitet", () => {
  it("samler alle kildene i én liste", async () => {
    const { orgId, vendorId } = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "Kari Nordmann");
    await nyttAvvik(orgId, "Kari Nordmann");
    await nyLoggforing(orgId, "Kari Nordmann");
    await nySignatur(orgId, bruker.id, 2026);

    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, bruker));

    expect(ut.hendelser.map((h) => h.slag).sort()).toEqual([
      "avvik",
      "driftslogg",
      "hms",
      "oppgave",
    ]);
    expect(ut.antall.oppgave).toBe(1);
    expect(ut.antall.behandling).toBe(0);
  });

  it("matcher navn uavhengig av store bokstaver og mellomrom", async () => {
    // Enhetsregisteret leverer navn i store bokstaver, og manuelt innskrevne navn har
    // etterslepende mellomrom oftere enn man tror. Begge skal finnes igjen.
    const { orgId, vendorId } = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "  KARI NORDMANN ");

    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, bruker));
    expect(ut.antall.oppgave).toBe(1);
  });

  it("viser ikke en annen persons rader", async () => {
    const { orgId, vendorId } = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "Ola Hansen");
    await nyttAvvik(orgId, "Ola Hansen");

    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, bruker));
    expect(ut.hendelser).toEqual([]);
  });

  it("krysser ikke org-grensen, selv med identisk navn", async () => {
    // Navnet er ikke en fremmednøkkel, så isolasjonen hviler på org-filteret og RLS. Sitter
    // samme person i to lag, skal hvert lag vise SITT.
    const a = await nyOrg();
    const b = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(a.orgId, a.vendorId, "Kari Nordmann");
    await nyUtkvittering(b.orgId, b.vendorId, "Kari Nordmann");
    await nyttAvvik(b.orgId, "Kari Nordmann");

    const ut = await i(a.orgId, (db) => hentMinAktivitet(db, a.orgId, bruker));
    expect(ut.antall.oppgave).toBe(1);
    expect(ut.antall.avvik).toBe(0);
  });

  it("utelater det som er eldre enn ett år", async () => {
    const { orgId, vendorId } = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "Kari Nordmann", dagerSiden(400));
    await nyLoggforing(orgId, "Kari Nordmann", dagerSiden(400));
    await nyttAvvik(orgId, "Kari Nordmann", dagerSiden(10));

    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, bruker));
    expect(ut.hendelser.map((h) => h.slag)).toEqual(["avvik"]);
  });

  it("sorterer nyeste først", async () => {
    const { orgId, vendorId } = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "Kari Nordmann", dagerSiden(30));
    await nyttAvvik(orgId, "Kari Nordmann", dagerSiden(1));

    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, bruker));
    expect(ut.hendelser.map((h) => h.slag)).toEqual(["avvik", "oppgave"]);
  });

  it("beholder aktiviteten gjennom et navnebytte når raden har id", async () => {
    // Hele grunnen til at id-kolonnene finnes. Raden bærer det GAMLE navnet — slik den skal,
    // protokollen skrives ikke om — men oppslaget finner den likevel, fordi det går på id.
    const { orgId, vendorId } = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "Kari Nordmann", new Date(), bruker.id);
    await nyttAvvik(orgId, "Kari Nordmann", new Date(), bruker.id);
    await nySignatur(orgId, bruker.id, 2025);

    const etterBytte = { id: bruker.id, name: "Kari Nordmann-Hansen" };
    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, etterBytte));

    expect(ut.antall.oppgave).toBe(1);
    expect(ut.antall.avvik).toBe(1);
    expect(ut.antall.hms).toBe(1);
  });

  it("faller tilbake på navn bare for rader UTEN id", async () => {
    // Rader fra QR-skjemaet og fra tiden før kolonnene finnes for godt. De skal fortsatt
    // dukke opp — ellers ville innføringen av id-en skjult historikk som var synlig før.
    const { orgId, vendorId } = await nyOrg();
    const bruker = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "Kari Nordmann");

    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, bruker));
    expect(ut.antall.oppgave).toBe(1);
  });

  it("lar id-en overstyre navnet: en annens rad med mitt navn er ikke min", async () => {
    // Den strengeste av de tre. Har raden en id, er den svaret — også når navnet på raden
    // tilfeldigvis er mitt. Uten dette ville navnereserven gjort id-en meningsløs.
    const { orgId, vendorId } = await nyOrg();
    const kari = await nyBruker("Kari Nordmann");
    const annen = await nyBruker("Kari Nordmann");
    await nyUtkvittering(orgId, vendorId, "Kari Nordmann", new Date(), annen.id);

    const ut = await i(orgId, (db) => hentMinAktivitet(db, orgId, kari));
    expect(ut.hendelser).toEqual([]);
  });
});
