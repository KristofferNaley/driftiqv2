/**
 * «Slett kunde» i plattformpanelet (`src/lib/kundesletting.ts`). Ingen v1-forgjenger — v1
 * hadde ingen sletting av kunder; bygget 01.10.2026 for testkunder som ikke gikk videre.
 *
 * Tyngdepunktet er at slettingen faktisk lykkes når kunden har data i tabellene UTEN
 * kaskade (oppgaver, avvik, enheter, leverandører …), at sperrene holder, og at bare
 * kontoer som ikke finnes andre steder forsvinner. Registertesten nederst feiler hvis en ny
 * tabell peker på `organizations` uten kaskade og uten å stå i `SLETTES_EKSPLISITT`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { SLETTES_EKSPLISITT, slettKunde, slettKundefiler } from "../src/lib/kundesletting";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddBruker: string[] = [];
const ryddLead: string[] = [];

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";
const aktor = { navn: "Testadmin", brukerId: null };

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
  // Det som står igjen når en test feilet før (eller i stedet for) slettingen.
  for (const id of ryddOrg.splice(0)) {
    const q = (s: string) => eier.query(s, [id]);
    await q("DELETE FROM deviations WHERE org_id = $1");
    await q("DELETE FROM routines WHERE org_id = $1");
    await q("DELETE FROM completions WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)");
    await q("DELETE FROM tasks WHERE org_id = $1");
    await q("DELETE FROM contracts WHERE org_id = $1");
    await q("DELETE FROM unit_works WHERE org_id = $1");
    await q("DELETE FROM building_elements WHERE org_id = $1");
    await q("DELETE FROM log_entries WHERE org_id = $1");
    await q("DELETE FROM units WHERE org_id = $1");
    await q("DELETE FROM vendors WHERE org_id = $1");
    await q("DELETE FROM support_access_log WHERE org_id = $1");
    await q("UPDATE users SET org_id = NULL WHERE org_id = $1");
    await q("DELETE FROM organizations WHERE id = $1");
    const { rm } = await import("node:fs/promises");
    await rm(path.join(UPLOAD_DIR, "orgs", id), { recursive: true, force: true });
  }
  for (const id of ryddLead.splice(0)) {
    await eier.query("DELETE FROM leads WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

const i = <T>(fn: (db: Parameters<Parameters<typeof withoutRls>[1]>[0]) => Promise<T>) =>
  withoutRls("plattformpanel", fn);

async function nyOrg(aktiv = false): Promise<string> {
  const id = `ks-${randomUUID()}`;
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active) VALUES ($1,'Prøvelaget',$1,$2)",
    [id, aktiv],
  );
  ryddOrg.push(id);
  return id;
}

async function nyBruker(orgIder: string[], rolle = "member"): Promise<string> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,'Test',$2,$3,true,true,now(),now())`,
    [id, `${id}@driftiq.test`, rolle],
  );
  for (const orgId of orgIder) {
    await eier.query(
      "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'orgadmin')",
      [randomUUID(), id, orgId],
    );
  }
  ryddBruker.push(id);
  return id;
}

async function antall(tabell: string, orgId: string): Promise<number> {
  const { rows } = await eier.query(`SELECT count(*)::int AS n FROM ${tabell} WHERE org_id = $1`, [orgId]);
  return rows[0].n;
}

/** Én rad i hver tabell uten kaskade, med kryssreferansene som gjør rekkefølgen viktig. */
async function fyllKunde(org: string) {
  const id = () => randomUUID();
  const [lev, enh, opp, utf, kon, rut, elem] = [id(), id(), id(), id(), id(), id(), id()];
  const q = (s: string, p: unknown[]) => eier.query(s, p);
  await q("INSERT INTO vendors (id, org_id, name) VALUES ($1,$2,'Rørlegger')", [lev, org]);
  await q("INSERT INTO vendor_contacts (id, org_id, vendor_id, name) VALUES ($1,$2,$3,'Kari')", [id(), org, lev]);
  await q("INSERT INTO units (id, org_id) VALUES ($1,$2)", [enh, org]);
  await q(
    "INSERT INTO tasks (id, org_id, vendor_id, unit_id, title, frequency) VALUES ($1,$2,$3,$4,'Sjekk','weekly')",
    [opp, org, lev, enh],
  );
  await q("INSERT INTO task_checklist_items (id, task_id, text) VALUES ($1,$2,'Punkt')", [id(), opp]);
  await q("INSERT INTO completions (id, task_id, completed_by, vendor_id) VALUES ($1,$2,'Ola',$3)", [utf, opp, lev]);
  await q(
    "INSERT INTO deviations (id, org_id, title, reported_by, task_id, unit_id, vendor_id, completion_id) VALUES ($1,$2,'Lekkasje','Ola',$3,$4,$5,$6)",
    [id(), org, opp, enh, lev, utf],
  );
  await q("INSERT INTO contracts (id, org_id, vendor_id, title) VALUES ($1,$2,$3,'Avtale')", [kon, org, lev]);
  await q(
    "INSERT INTO routines (id, org_id, title, task_id, contract_id, vendor_id) VALUES ($1,$2,'Rutine',$3,$4,$5)",
    [rut, org, opp, kon, lev],
  );
  await q("INSERT INTO building_elements (id, org_id, name, vendor_id) VALUES ($1,$2,'Tak',$3)", [elem, org, lev]);
  await q(
    "INSERT INTO unit_works (id, org_id, unit_id, unit_label, work_date, title, created_by, vendor_id, element_id) VALUES ($1,$2,$3,'H0101',current_date,'Bad','Ola',$4,$5)",
    [id(), org, enh, lev, elem],
  );
  await q(
    "INSERT INTO log_entries (id, org_id, title, entry_date, created_by, vendor_id) VALUES ($1,$2,'Logg',current_date,'Ola',$3)",
    [id(), org, lev],
  );
  await q("INSERT INTO support_access_log (id, org_id, reason) VALUES ($1,$2,'test')", [id(), org]);
  await q("INSERT INTO platform_contracts (id, org_id) VALUES ($1,$2)", [id(), org]);
}

const feilmelding = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return { status: (e as ApiFeil).status, melding: (e as Error).message };
  }
  throw new Error("Forventet feil");
};

describe("slettKunde", () => {
  it("sletter kunden med data i alle tabellene uten kaskade", async () => {
    const org = await nyOrg();
    await fyllKunde(org);

    const svar = await i((db) => slettKunde(db, org, { bekreftNavn: "Prøvelaget" }, aktor));
    expect(svar.navn).toBe("Prøvelaget");

    const { rows } = await eier.query("SELECT 1 FROM organizations WHERE id = $1", [org]);
    expect(rows).toHaveLength(0);
    for (const t of ["tasks", "deviations", "units", "vendors", "vendor_contacts", "contracts",
      "routines", "building_elements", "unit_works", "log_entries", "support_access_log",
      "platform_contracts", "user_org_memberships"]) {
      expect(await antall(t, org), t).toBe(0);
    }
  });

  it("sletter kontoer som bare finnes her, beholder de som er med andre steder og plattformadmin", async () => {
    const org = await nyOrg();
    const annen = await nyOrg(true);
    const bareHer = await nyBruker([org]);
    const begge = await nyBruker([org, annen]);
    const admin = await nyBruker([org], "superadmin");
    await eier.query("UPDATE users SET org_id = $1 WHERE id = $2", [org, begge]);

    const svar = await i((db) => slettKunde(db, org, { bekreftNavn: "Prøvelaget" }, aktor));
    expect(svar).toMatchObject({ slettedeBrukere: 1, beholdteBrukere: 2 });

    const { rows } = await eier.query("SELECT id, org_id FROM users WHERE id = ANY($1)", [[bareHer, begge, admin]]);
    expect(rows.map((r) => r.id).sort()).toEqual([begge, admin].sort());
    expect(rows.find((r) => r.id === begge)!.org_id).toBeNull();
  });

  it("nekter en aktiv kunde — den må settes inaktiv først", async () => {
    const org = await nyOrg(true);
    const f = await feilmelding(i((db) => slettKunde(db, org, { bekreftNavn: "Prøvelaget" }, aktor)));
    expect(f.status).toBe(400);
    expect(f.melding).toMatch(/inaktiv/);
    expect((await eier.query("SELECT 1 FROM organizations WHERE id = $1", [org])).rows).toHaveLength(1);
  });

  it("nekter når navnet ikke stemmer", async () => {
    const org = await nyOrg();
    const f = await feilmelding(i((db) => slettKunde(db, org, { bekreftNavn: "Provelaget" }, aktor)));
    expect(f.melding).toMatch(/stemmer ikke/);
    expect((await eier.query("SELECT 1 FROM organizations WHERE id = $1", [org])).rows).toHaveLength(1);
  });

  it("nekter så lenge Unloc-nøkler ikke er trukket tilbake, men slipper utløpte", async () => {
    const org = await nyOrg();
    const lev = randomUUID();
    await eier.query("INSERT INTO vendors (id, org_id, name) VALUES ($1,$2,'Vekter')", [lev, org]);
    const nokkel = randomUUID();
    await eier.query(
      `INSERT INTO vendor_unloc_keys (id, org_id, vendor_id, unloc_key_id, lock_id, lock_name, phone, holder_name, start_at, issued_by, state)
       VALUES ($1,$2,$3,'k','l','Port','+4790000000','Per',now(),'Ola','active')`,
      [nokkel, org, lev],
    );
    const f = await feilmelding(i((db) => slettKunde(db, org, { bekreftNavn: "Prøvelaget" }, aktor)));
    expect(f.status).toBe(409);

    await eier.query("UPDATE vendor_unloc_keys SET state = 'expired' WHERE id = $1", [nokkel]);
    await i((db) => slettKunde(db, org, { bekreftNavn: "Prøvelaget" }, aktor));
    expect((await eier.query("SELECT 1 FROM vendor_unloc_keys WHERE id = $1", [nokkel])).rows).toHaveLength(0);
  });

  it("lar leaden stå som konvertert, uten kobling og med en linje i loggen", async () => {
    const org = await nyOrg();
    const lead = randomUUID();
    await eier.query(
      "INSERT INTO leads (id, name, email, status, converted_org_id) VALUES ($1,'Kari','k@driftiq.test','konvertert',$2)",
      [lead, org],
    );
    ryddLead.push(lead);

    await i((db) => slettKunde(db, org, { bekreftNavn: "Prøvelaget" }, aktor));

    const { rows } = await eier.query("SELECT status, converted_org_id FROM leads WHERE id = $1", [lead]);
    expect(rows[0]).toEqual({ status: "konvertert", converted_org_id: null });
    const akt = await eier.query("SELECT text, note FROM lead_activities WHERE lead_id = $1", [lead]);
    expect(akt.rows).toContainEqual({ text: "Kunden slettet", note: "Prøvelaget" });
  });
});

describe("slettKundefiler", () => {
  it("fjerner hele org-mappa under uploads", async () => {
    const org = `ks-${randomUUID()}`;
    const mappe = path.join(UPLOAD_DIR, "orgs", org, "documents");
    await mkdir(mappe, { recursive: true });
    await writeFile(path.join(mappe, "a.pdf"), "x");

    await slettKundefiler(org);
    await expect(stat(path.join(UPLOAD_DIR, "orgs", org))).rejects.toThrow();
    // Finnes ikke mappa, er det ingen feil.
    await slettKundefiler(org);
  });
});

describe("SLETTES_EKSPLISITT", () => {
  it("dekker nøyaktig fremmednøklene mot organizations uten kaskade", async () => {
    const { rows } = await eier.query(`
      SELECT DISTINCT tc.table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND ccu.table_name = 'organizations' AND rc.delete_rule NOT IN ('CASCADE', 'SET NULL')`);
    expect(rows.map((r) => r.table_name).sort()).toEqual(Object.keys(SLETTES_EKSPLISITT).sort());
  });
});
