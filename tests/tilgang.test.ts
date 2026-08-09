/**
 * Tilgangsgatene — port av `test_access_tier.py` og `test_support_session_utlop.py`.
 *
 * Gatene kjøres her gjennom `withOrg()`, altså nøyaktig slik et endepunkt vil kalle dem.
 * Det er med vilje: kjørte testene gatene mot en løs tilkobling, ville de ikke fanget at
 * tabellene de leser faktisk er synlige inne i en org-transaksjon.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { User } from "../src/db/schema/users";
import {
  SUPPORT_SESJON_MAKS_TIMER,
  Tilgangsfeil,
  abonnementUtlopt,
  harOrgAdmin,
  krevOrgAdmin,
  krevOrgRedigering,
  krevOrgTilgang,
  supportSesjonUtlop,
} from "../src/lib/tilgang";

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
    await eier.query("DELETE FROM support_access_log WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM platform_contracts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM user_org_memberships WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyOrg(aktiv = true): Promise<string> {
  const id = `tilgang-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1, $2, $3, $4)", [
    id,
    "Testlaget",
    id,
    aktiv,
  ]);
  ryddOrg.push(id);
  return id;
}

async function nyBruker(rolle = "member"): Promise<User> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, true, now(), now())`,
    [id, id.slice(0, 8), `${id}@driftiq.test`, rolle],
  );
  ryddBruker.push(id);
  const { rows } = await eier.query<User>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0]!;
}

async function girMedlemskap(bruker: User, orgId: string, nivaa: string, tittel?: string) {
  await eier.query(
    "INSERT INTO user_org_memberships (id, user_id, org_id, role, title) VALUES ($1,$2,$3,$4,$5)",
    [randomUUID(), bruker.id, orgId, nivaa, tittel ?? null],
  );
}

/** Kjører en gate slik et endepunkt ville gjort det, og returnerer feilen eller null. */
async function gate(
  orgId: string,
  fn: (db: Parameters<Parameters<typeof withOrg>[1]>[0]) => Promise<unknown>,
): Promise<Tilgangsfeil | null> {
  return withOrg(orgId, async (db) => {
    try {
      await fn(db);
      return null;
    } catch (e) {
      if (e instanceof Tilgangsfeil) return e;
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------------------
// Tilgangsnivåer. Tre nivåer, stigende — og tittelen styrer ingenting.
// ---------------------------------------------------------------------------------------

describe("tilgangsnivåer", () => {
  it("orgadmin har både drift- og kontotilgang", async () => {
    const org = await nyOrg();
    const b = await nyBruker();
    await girMedlemskap(b, org, "orgadmin");

    expect(await gate(org, (db) => krevOrgRedigering(db, org, b))).toBeNull();
    expect(await gate(org, (db) => krevOrgAdmin(db, org, b))).toBeNull();
    expect(await withOrg(org, (db) => harOrgAdmin(db, org, b))).toBe(true);
  });

  it("redigering gir driftstilgang, men ikke kontosidene", async () => {
    const org = await nyOrg();
    const b = await nyBruker();
    await girMedlemskap(b, org, "redigering");

    expect(await gate(org, (db) => krevOrgRedigering(db, org, b))).toBeNull();
    const feil = await gate(org, (db) => krevOrgAdmin(db, org, b));
    expect(feil?.status).toBe(403);
    expect(feil?.message).toMatch(/administratortilgang/i);
    expect(await withOrg(org, (db) => harOrgAdmin(db, org, b))).toBe(false);
  });

  it("visning har verken drift- eller kontotilgang", async () => {
    const org = await nyOrg();
    const b = await nyBruker();
    await girMedlemskap(b, org, "visning");

    // Lesing er greit …
    expect(await gate(org, (db) => krevOrgTilgang(db, org, b))).toBeNull();
    // … men ingenting som endrer.
    expect((await gate(org, (db) => krevOrgRedigering(db, org, b)))?.message).toMatch(
      /kun visningstilgang/i,
    );
    expect(await gate(org, (db) => krevOrgAdmin(db, org, b))).not.toBeNull();
  });

  it("tittelen påvirker ikke tilgang", async () => {
    // Fram til 08.08.2026 utledet v1 tilgang av tittelen («varamedlem» = visning). Regelen
    // var usynlig for kunden og overrasket når noen byttet tittel. Nå er nivået eksplisitt.
    const org = await nyOrg();
    const b = await nyBruker();
    await girMedlemskap(b, org, "orgadmin", "Varamedlem");

    expect(await gate(org, (db) => krevOrgAdmin(db, org, b))).toBeNull();
  });

  it("intet medlemskap gir ingen tilgang", async () => {
    const org = await nyOrg();
    const b = await nyBruker();

    const feil = await gate(org, (db) => krevOrgTilgang(db, org, b));
    expect(feil?.status).toBe(403);
    expect(feil?.message).toMatch(/ingen tilgang/i);
  });
});

// ---------------------------------------------------------------------------------------
// Abonnement. Fraværet av en kontrakt skal ALDRI stenge noen ute.
// ---------------------------------------------------------------------------------------

describe("abonnementssperren", () => {
  async function kontrakt(orgId: string, sluttdato: string | null) {
    await eier.query(
      "INSERT INTO platform_contracts (id, org_id, end_date, discount_percent) VALUES ($1,$2,$3,0)",
      [randomUUID(), orgId, sluttdato],
    );
  }

  it("ingen kontrakt sperrer ingenting", async () => {
    const org = await nyOrg();
    expect(await withOrg(org, (db) => abonnementUtlopt(db, org))).toBe(false);
  });

  it("løpende kontrakt uten sluttdato holder tilgangen åpen", async () => {
    const org = await nyOrg();
    await kontrakt(org, null);
    expect(await withOrg(org, (db) => abonnementUtlopt(db, org))).toBe(false);
  });

  it("utløpt kontrakt sperrer", async () => {
    const org = await nyOrg();
    await kontrakt(org, "2020-01-01");
    expect(await withOrg(org, (db) => abonnementUtlopt(db, org))).toBe(true);
  });

  it("én gyldig kontrakt av flere holder tilgangen åpen", async () => {
    const org = await nyOrg();
    await kontrakt(org, "2020-01-01");
    await kontrakt(org, "2099-01-01");
    expect(await withOrg(org, (db) => abonnementUtlopt(db, org))).toBe(false);
  });

  it("utløpt abonnement stenger et ellers gyldig medlemskap", async () => {
    const org = await nyOrg();
    const b = await nyBruker();
    await girMedlemskap(b, org, "orgadmin");
    await kontrakt(org, "2020-01-01");

    expect((await gate(org, (db) => krevOrgTilgang(db, org, b)))?.message).toMatch(/utløpt/i);
    expect((await gate(org, (db) => krevOrgAdmin(db, org, b)))?.message).toMatch(/utløpt/i);
  });
});

// ---------------------------------------------------------------------------------------
// Support-sesjoner. Plattformadmin har IKKE automatisk tilgang til kundedata.
// ---------------------------------------------------------------------------------------

describe("support-sesjoner", () => {
  async function sesjon(
    orgId: string,
    adminId: string,
    opts: { utloper?: Date | null; avsluttet?: boolean } = {},
  ) {
    await eier.query(
      `INSERT INTO support_access_log (id, superadmin_id, admin_name, org_id, reason, expires_at, ended_at)
       VALUES ($1,$2,'Test',$3,'testing',$4,$5)`,
      [
        randomUUID(),
        adminId,
        orgId,
        opts.utloper === undefined ? supportSesjonUtlop() : opts.utloper,
        opts.avsluttet ? new Date() : null,
      ],
    );
  }

  it("uten sesjon slipper ikke plattformadmin inn", async () => {
    const org = await nyOrg();
    const admin = await nyBruker("superadmin");
    const feil = await gate(org, (db) => krevOrgTilgang(db, org, admin));
    expect(feil?.message).toMatch(/support-modus/i);
  });

  it("fersk sesjon gir tilgang", async () => {
    const org = await nyOrg();
    const admin = await nyBruker("superadmin");
    await sesjon(org, admin.id);

    expect(await gate(org, (db) => krevOrgTilgang(db, org, admin))).toBeNull();
    expect(await gate(org, (db) => krevOrgAdmin(db, org, admin))).toBeNull();
  });

  it("utløpt sesjon stenger både lesing og skriving", async () => {
    const org = await nyOrg();
    const admin = await nyBruker("superadmin");
    await sesjon(org, admin.id, { utloper: new Date(Date.now() - 60_000) });

    expect(await gate(org, (db) => krevOrgTilgang(db, org, admin))).not.toBeNull();
    expect(await gate(org, (db) => krevOrgAdmin(db, org, admin))).not.toBeNull();
  });

  it("manuelt avsluttet sesjon gir ikke tilgang", async () => {
    const org = await nyOrg();
    const admin = await nyBruker("superadmin");
    await sesjon(org, admin.id, { avsluttet: true });
    expect(await gate(org, (db) => krevOrgTilgang(db, org, admin))).not.toBeNull();
  });

  it("rad uten utløpstid gir ikke tilgang", async () => {
    // Rader fra før grensen ble innført mangler `expires_at`. NULL > now() er NULL, altså
    // ikke sant — de faller ut av seg selv. Det er riktig retning å feile i.
    const org = await nyOrg();
    const admin = await nyBruker("superadmin");
    await sesjon(org, admin.id, { utloper: null });
    expect(await gate(org, (db) => krevOrgTilgang(db, org, admin))).not.toBeNull();
  });

  it("sesjon for en annen org gir ikke tilgang", async () => {
    const annen = await nyOrg();
    const org = await nyOrg();
    const admin = await nyBruker("superadmin");
    await sesjon(annen, admin.id);
    expect(await gate(org, (db) => krevOrgTilgang(db, org, admin))).not.toBeNull();
  });

  it("utløpstiden settes maks timer fram i tid", async () => {
    const naa = Date.now();
    const utlop = supportSesjonUtlop().getTime();
    const timer = (utlop - naa) / (60 * 60 * 1000);
    expect(timer).toBeGreaterThan(SUPPORT_SESJON_MAKS_TIMER - 0.01);
    expect(timer).toBeLessThanOrEqual(SUPPORT_SESJON_MAKS_TIMER);
  });
});

