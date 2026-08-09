/**
 * Varselinnstillinger — port av v1s `varsler.py`-oppførsel.
 *
 * De to viktige egenskapene her er ikke «lagrer og leser tilbake», men:
 *
 *  1. **Ukjente nøkler fra basen overlever.** Tas et varsel midlertidig ut av koden, skal
 *     verdien ligge igjen i kolonnen — ikke bli slettet ved neste lagring.
 *  2. **Ukjente nøkler fra KLIENTEN slippes ikke inn.** Skjemaet er fritt JSON på vei inn,
 *     så uten filtreringen kunne hva som helst havnet i kolonnen.
 *
 * De to trekker i hver sin retning, og det er lett å implementere den ene og miste den andre.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { hentVarsler, lesPrefs, settVarsler } from "../src/lib/varsler";
import { VARSEL_STANDARD } from "../src/lib/varselvalg";

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
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM user_org_memberships WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

/** Org + bruker + medlemskap, som et endepunkt ville sett dem. */
async function oppsett(): Promise<{ orgId: string; brukerId: string }> {
  const orgId = `varsler-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId,
    "Testlaget",
    orgId,
  ]);
  ryddOrg.push(orgId);

  const brukerId = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,$2,$3,'member',true,true,now(),now())`,
    [brukerId, brukerId.slice(0, 8), `${brukerId}@driftiq.test`],
  );
  ryddBruker.push(brukerId);

  await eier.query(
    "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'redigering')",
    [randomUUID(), brukerId, orgId],
  );
  return { orgId, brukerId };
}

describe("lesPrefs", () => {
  it("gir standardene når kolonnen er tom", () => {
    expect(lesPrefs(null)).toEqual(VARSEL_STANDARD);
  });

  it("fyller inn nøkler som mangler i det lagrede settet", () => {
    // Bare én nøkkel lagret: resten skal komme fra standardene, ikke bli borte.
    const ut = lesPrefs(JSON.stringify({ new_deviation: true }));
    expect(ut.new_deviation).toBe(true);
    expect(ut.deviation_activity).toBe(VARSEL_STANDARD.deviation_activity);
    expect(Object.keys(ut).sort()).toEqual(Object.keys(VARSEL_STANDARD).sort());
  });

  it("faller tilbake til standardene på ødelagt JSON i stedet for å kaste", () => {
    // En halvskrevet verdi i basen skal ikke gi 500 på en side som bare viser brytere.
    expect(lesPrefs("{ikke json")).toEqual(VARSEL_STANDARD);
  });

  it("beholder ukjente nøkler fra basen", () => {
    const ut = lesPrefs(JSON.stringify({ varsel_som_ble_fjernet: true }));
    expect(ut.varsel_som_ble_fjernet).toBe(true);
  });
});

describe("settVarsler", () => {
  it("lagrer og leser tilbake gjennom org-konteksten", async () => {
    const { orgId, brukerId } = await oppsett();
    await withOrg(orgId, async (db) => {
      await settVarsler(db, orgId, brukerId, { new_deviation: true });
      const { prefs } = await hentVarsler(db, orgId, brukerId);
      expect(prefs.new_deviation).toBe(true);
      // De andre skal stå urørt på standardverdien.
      expect(prefs.overdue_task).toBe(VARSEL_STANDARD.overdue_task);
    });
  });

  it("slipper ikke ukjente nøkler fra klienten inn i kolonnen", async () => {
    const { orgId, brukerId } = await oppsett();
    await withOrg(orgId, async (db) => {
      await settVarsler(db, orgId, brukerId, {
        new_deviation: true,
        vilkarlig_nokkel: true,
      } as Record<string, boolean>);
    });
    const { rows } = await eier.query<{ notification_prefs: string }>(
      "SELECT notification_prefs FROM user_org_memberships WHERE user_id = $1",
      [brukerId],
    );
    const lagret = JSON.parse(rows[0]!.notification_prefs) as Record<string, boolean>;
    expect(lagret.new_deviation).toBe(true);
    expect("vilkarlig_nokkel" in lagret).toBe(false);
  });

  it("lar en delvis oppdatering stå igjen med de andre verdiene", async () => {
    const { orgId, brukerId } = await oppsett();
    await withOrg(orgId, async (db) => {
      await settVarsler(db, orgId, brukerId, { new_deviation: true, overdue_task: true });
      // Andre runde nevner bare ÉN nøkkel — den andre skal ikke falle tilbake til standard.
      await settVarsler(db, orgId, brukerId, { new_deviation: false });
      const { prefs } = await hentVarsler(db, orgId, brukerId);
      expect(prefs.new_deviation).toBe(false);
      expect(prefs.overdue_task).toBe(true);
    });
  });

  it("svarer 404 for en bruker som ikke er medlem av org-en", async () => {
    const { orgId } = await oppsett();
    await withOrg(orgId, async (db) => {
      await expect(hentVarsler(db, orgId, randomUUID())).rejects.toThrow();
    });
  });
});
