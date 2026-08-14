/**
 * Den periodiske varselsjobben.
 *
 * Jobben kjører uten tilskuer kl. 07 hver morgen. Er den feil, merkes det ikke som en
 * feilmelding — det merkes som at styret slutter å få e-post, eller får den hver dag til de
 * skrur den av. Begge deler er stille.
 *
 * `kjorVarsler(naa)` tar tidspunktet som argument nettopp for å kunne testes: uten det måtte
 * en test av mandagssammendraget vente til mandag.
 *
 * Sendingen selv er avslått her (ingen RESEND_API_KEY i testmiljøet), så testene måler
 * ANTALL mottakere jobben fant — altså hvem som ville fått e-post.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler } from "../src/db/client";
import { kjorVarsler } from "../src/lib/varselsjobb";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddBruker: string[] = [];

/** En mandag og en tirsdag, begge midt på dagen for å unngå soneskliing. */
const MANDAG = new Date("2026-08-10T09:00:00Z");
const TIRSDAG = new Date("2026-08-11T09:00:00Z");

/** Org-ene som VAR aktive før testkjøringen — bare de skal aktiveres igjen etterpå. */
let varAktive: string[] = [];

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
  // Andre org-er i basen skal ikke påvirke tellingen. Jobben går på TVERS av kunder, så
  // testene deaktiverer alt annet og slår det på igjen etterpå. Snapshotet er viktig:
  // «alt som ikke er vårt» ville også reaktivert kunder som var deaktivert med vilje.
  varAktive = (
    await eier.query<{ id: string }>("SELECT id FROM organizations WHERE active = true")
  ).rows.map((r) => r.id);
  await eier.query("UPDATE organizations SET active = false WHERE active = true");
});

afterAll(async () => {
  for (const id of varAktive) {
    await eier.query("UPDATE organizations SET active = true WHERE id = $1", [id]);
  }
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  // Org-ene FØRST: `tasks.responsible_user_id` peker på brukerne, så en bruker kan ikke
  // slettes før oppgavene som viser til den er borte.
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM contracts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM completions WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM user_org_memberships WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `vjobb-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,'Testlaget',$1,true)", [id]);
  ryddOrg.push(id);
  return id;
}

/** Bruker med medlemskap og et gitt varseloppsett. */
async function nyBruker(orgId: string, prefs: Record<string, boolean>): Promise<string> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,'Kari Styremedlem',$2,'member',true,true,now(),now())`,
    [id, `${id}@driftiq.test`],
  );
  ryddBruker.push(id);
  await eier.query(
    `INSERT INTO user_org_memberships (id, user_id, org_id, role, notification_prefs)
     VALUES ($1,$2,$3,'redigering',$4)`,
    [randomUUID(), id, orgId, JSON.stringify(prefs)],
  );
  return id;
}

/** Oppgave som ER forsinket: ukentlig, startet for lenge siden, aldri utkvittert. */
async function forsinketOppgave(orgId: string, ansvarligId?: string) {
  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name) VALUES ($1,$2,'Renhold AS')", [vendorId, orgId]);
  const id = randomUUID();
  await eier.query(
    `INSERT INTO tasks (id, org_id, vendor_id, title, frequency, active, start_date, responsible_user_id)
     VALUES ($1,$2,$3,'Trappevask','weekly',true,'2026-01-01',$4)`,
    [id, orgId, vendorId, ansvarligId ?? null],
  );
  return id;
}

async function kontraktMedSlutt(orgId: string, sluttDato: string) {
  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name) VALUES ($1,$2,'Heis AS')", [vendorId, orgId]);
  await eier.query(
    "INSERT INTO contracts (id, org_id, vendor_id, title, end_date) VALUES ($1,$2,$3,'Heisavtale',$4)",
    [randomUUID(), orgId, vendorId, sluttDato],
  );
}

describe("forsinkede oppgaver", () => {
  it("sender ukesammendrag til dem som har bedt om det — men bare på mandag", async () => {
    const orgId = await nyOrg();
    await nyBruker(orgId, { overdue_task: true });
    await forsinketOppgave(orgId);

    expect((await kjorVarsler(MANDAG)).forsinkede).toBe(1);
    // Daglig sammendrag ville blitt støy, og styret ville skrudd det av.
    expect((await kjorVarsler(TIRSDAG)).forsinkede).toBe(0);
  });

  it("sender ikke til dem som har skrudd varselet av", async () => {
    const orgId = await nyOrg();
    await nyBruker(orgId, { overdue_task: false });
    await forsinketOppgave(orgId);
    expect((await kjorVarsler(MANDAG)).forsinkede).toBe(0);
  });

  it("sender ingenting når ingenting er forsinket", async () => {
    const orgId = await nyOrg();
    await nyBruker(orgId, { overdue_task: true });
    expect((await kjorVarsler(MANDAG)).forsinkede).toBe(0);
  });

  it("hopper over deaktiverte organisasjoner", async () => {
    const orgId = await nyOrg();
    await nyBruker(orgId, { overdue_task: true });
    await forsinketOppgave(orgId);
    await eier.query("UPDATE organizations SET active = false WHERE id = $1", [orgId]);
    expect((await kjorVarsler(MANDAG)).forsinkede).toBe(0);
  });
});

describe("mine forsinkede oppgaver", () => {
  it("varsler den ansvarlige personlig", async () => {
    const orgId = await nyOrg();
    const brukerId = await nyBruker(orgId, { my_overdue_task: true, overdue_task: false });
    await forsinketOppgave(orgId, brukerId);
    expect((await kjorVarsler(MANDAG)).mine).toBe(1);
  });

  it("varsler ikke om oppgaver uten ansvarlig", async () => {
    // Uten ansvarlig finnes det ingen «min» oppgave å minne noen om — den hører hjemme i
    // lagets sammendrag, ikke i en personlig påminnelse.
    const orgId = await nyOrg();
    await nyBruker(orgId, { my_overdue_task: true });
    await forsinketOppgave(orgId);
    expect((await kjorVarsler(MANDAG)).mine).toBe(0);
  });

  it("respekterer at den ansvarlige har skrudd varselet av", async () => {
    const orgId = await nyOrg();
    const brukerId = await nyBruker(orgId, { my_overdue_task: false });
    await forsinketOppgave(orgId, brukerId);
    expect((await kjorVarsler(MANDAG)).mine).toBe(0);
  });
});

describe("kontrakter som utløper", () => {
  it("varsler på en milepæl, og bare da", async () => {
    const orgId = await nyOrg();
    await nyBruker(orgId, { contract_expiring: true });
    // Nøyaktig 30 dager fram fra mandagen.
    await kontraktMedSlutt(orgId, "2026-09-09");
    expect((await kjorVarsler(MANDAG)).kontrakter).toBe(1);
    // Dagen etter er det 29 dager igjen — ingen milepæl, ingen e-post. Uten dette ville
    // samme varsel gått ut hver dag i et halvt år.
    expect((await kjorVarsler(TIRSDAG)).kontrakter).toBe(0);
  });

  it("varsler uavhengig av ukedag", async () => {
    const orgId = await nyOrg();
    await nyBruker(orgId, { contract_expiring: true });
    await kontraktMedSlutt(orgId, "2026-08-18"); // 7 dager fra tirsdagen
    expect((await kjorVarsler(TIRSDAG)).kontrakter).toBe(1);
  });

  it("hopper over arkiverte avtaler", async () => {
    // Arkiverte avtaler er bevisst avsluttet — å varsle om at de utløper er støy.
    const orgId = await nyOrg();
    await nyBruker(orgId, { contract_expiring: true });
    await kontraktMedSlutt(orgId, "2026-09-09");
    await eier.query("UPDATE contracts SET archived_at = now() WHERE org_id = $1", [orgId]);
    expect((await kjorVarsler(MANDAG)).kontrakter).toBe(0);
  });
});
