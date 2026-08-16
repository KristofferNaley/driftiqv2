/**
 * `orgRute()` — wrapperen alle modulruter bygges av.
 *
 * Dette er den viktigste testfila i prosjektet etter `rls.test.ts`. Hver rute i v2 arver sine
 * gater herfra i stedet for å kalle dem selv, så en feil her gjelder ikke ett endepunkt, men
 * alle. Testene kaller de ekte rutehandlerne fra `src/app/api/...`, ikke en kopi.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { auth } from "../src/lib/auth";
import { lukkPooler } from "../src/db/client";
import { GET as hentPlasser, POST as nyPlass } from "../src/app/api/organizations/[orgId]/parking/spots/route";
import { GET as hentUtforelsesbilde } from "../src/app/api/organizations/[orgId]/tasks/[taskId]/completions/[completionId]/bilder/[bildeId]/fil/route";

const PASSORD = "et-godt-passord-123";

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
    await eier.query("DELETE FROM completion_photos WHERE org_id = $1", [id]);
    await eier.query(
      "DELETE FROM completions WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM parking_spots WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM session WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM account WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE user_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyOrg(moduler: string[] | null = ["parkering"]): Promise<string> {
  const id = `api-${randomUUID()}`;
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active, enabled_modules) VALUES ($1,$2,$3,true,$4)",
    [id, "API-laget", id, moduler === null ? null : JSON.stringify(moduler)],
  );
  ryddOrg.push(id);
  return id;
}

/** Bruker med medlemskap, innlogget. Returnerer cookie-headeren rutene forventer. */
async function innloggetBruker(orgId: string | null, nivaa: string, rolle = "member") {
  const id = randomUUID();
  const epost = `api-${id}@driftiq.test`;
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,'API-bruker',$2,$3,true,true,now(),now())`,
    [id, epost, rolle],
  );
  await eier.query(
    `INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES ($1,$2,$3,'credential',$4,now(),now())`,
    [randomUUID(), id, id, await bcrypt.hash(PASSORD, 12)],
  );
  if (orgId) {
    await eier.query(
      "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,$4)",
      [randomUUID(), id, orgId, nivaa],
    );
  }
  ryddBruker.push(id);

  const svar = await auth.api.signInEmail({
    body: { email: epost, password: PASSORD },
    asResponse: true,
  });
  const cookie = (svar.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { id, cookie };
}

function foresporsel(cookie: string | null, kropp?: unknown): Request {
  return new Request("http://localhost:3008/api/organizations/x/parking/spots", {
    method: kropp ? "POST" : "GET",
    headers: cookie ? { cookie, "content-type": "application/json" } : {},
    body: kropp ? JSON.stringify(kropp) : undefined,
  });
}

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });

describe("orgRute", () => {
  it("svarer 401 uten sesjon", async () => {
    const org = await nyOrg();
    const svar = await hentPlasser(foresporsel(null), ctx(org));
    expect(svar.status).toBe(401);
    expect((await svar.json()).detail).toBe("Ikke innlogget");
  });

  it("svarer 403 for en bruker uten medlemskap", async () => {
    const org = await nyOrg();
    const { cookie } = await innloggetBruker(null, "visning");
    const svar = await hentPlasser(foresporsel(cookie), ctx(org));
    expect(svar.status).toBe(403);
    expect((await svar.json()).detail).toMatch(/ingen tilgang/i);
  });

  it("lar visning lese, men ikke skrive", async () => {
    const org = await nyOrg();
    const { cookie } = await innloggetBruker(org, "visning");

    expect((await hentPlasser(foresporsel(cookie), ctx(org))).status).toBe(200);

    const skriv = await nyPlass(foresporsel(cookie, { number: "1" }), ctx(org));
    expect(skriv.status).toBe(403);
    expect((await skriv.json()).detail).toMatch(/kun visningstilgang/i);
  });

  it("lar redigering både lese og skrive", async () => {
    const org = await nyOrg();
    const { cookie } = await innloggetBruker(org, "redigering");

    const skriv = await nyPlass(foresporsel(cookie, { number: "42" }), ctx(org));
    expect(skriv.status).toBe(200);
    expect((await skriv.json()).number).toBe("42");
  });

  it("svarer 403 når modulen ikke er aktivert", async () => {
    const org = await nyOrg([]); // eksplisitt tom liste — parkering er av
    const { cookie } = await innloggetBruker(org, "orgadmin");
    const svar = await hentPlasser(foresporsel(cookie), ctx(org));
    expect(svar.status).toBe(403);
    expect((await svar.json()).detail).toMatch(/ikke aktivert/i);
  });

  it("røper ikke modulstatus til noen utenfor organisasjonen", async () => {
    // Modulsjekken skal kjøre ETTER tilgangsgaten. Gjorde den ikke det, kunne en utenforstående
    // lese ut hvilke moduler en kunde har kjøpt ved å se hvilken 403-melding de fikk.
    const org = await nyOrg([]);
    const { cookie } = await innloggetBruker(null, "visning");
    const svar = await hentPlasser(foresporsel(cookie), ctx(org));
    expect(svar.status).toBe(403);
    expect((await svar.json()).detail).toMatch(/ingen tilgang/i);
  });

  it("validerer kroppen og gir norsk feilmelding", async () => {
    const org = await nyOrg();
    const { cookie } = await innloggetBruker(org, "redigering");
    const svar = await nyPlass(foresporsel(cookie, { number: "" }), ctx(org));
    expect(svar.status).toBe(400);
    expect((await svar.json()).detail).toMatch(/må fylles ut/i);
  });

  it("ser ikke data fra en annen org selv med gyldig sesjon", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const { cookie } = await innloggetBruker(a, "orgadmin");

    await nyPlass(foresporsel(cookie, { number: "i-org-a" }), ctx(a));

    // Samme bruker, men org B i URL-en: ingen medlemskap der ⇒ 403, ikke lekkasje.
    const svar = await hentPlasser(foresporsel(cookie), ctx(b));
    expect(svar.status).toBe(403);
  });

  it("stenger ute en bruker som er deaktivert etter innlogging", async () => {
    // Sesjonen bærer en kopi av brukeren. Leste ruta den kopien, ville en deaktivering først
    // bitt ved neste innlogging — symptomet fra v1 der tilgangen var et snapshot per økt.
    const org = await nyOrg();
    const { id, cookie } = await innloggetBruker(org, "orgadmin");
    expect((await hentPlasser(foresporsel(cookie), ctx(org))).status).toBe(200);

    await eier.query("UPDATE users SET active = false WHERE id = $1", [id]);

    const svar = await hentPlasser(foresporsel(cookie), ctx(org));
    expect(svar.status).toBe(401);
  });
});

/**
 * Utførelsesbildene fra QR-kvitteringen.
 *
 * Ruta ligger under `/tasks/{taskId}/completions/{id}/bilder/…`, og `org_id` på bildet alene
 * er IKKE nok: uten joinen mot `completions` kunne et bilde fra en hvilken som helst annen
 * oppgave i samme lag leses gjennom denne oppgavens URL. Det er ingen tenantlekkasje, men det
 * er en oppgave som viser fram dokumentasjon som ikke hører til den — og i en
 * internkontrollperm er det nettopp koblingen som er poenget.
 */
describe("utførelsesbilder", () => {
  const bildeCtx = (orgId: string, taskId: string, completionId: string, bildeId: string) => ({
    params: Promise.resolve({ orgId, taskId, completionId, bildeId }),
  });

  async function oppsett(orgId: string) {
    const vendorId = randomUUID();
    await eier.query("INSERT INTO vendors (id, org_id, name) VALUES ($1,$2,'Leverandør')", [
      vendorId,
      orgId,
    ]);
    const lagTask = async () => {
      const id = randomUUID();
      await eier.query(
        "INSERT INTO tasks (id, org_id, vendor_id, title, frequency) VALUES ($1,$2,$3,'Oppgave','annual')",
        [id, orgId, vendorId],
      );
      return id;
    };
    const taskA = await lagTask();
    const taskB = await lagTask();

    const completionId = randomUUID();
    await eier.query(
      "INSERT INTO completions (id, task_id, completed_by) VALUES ($1,$2,'Leverandøren')",
      [completionId, taskA],
    );
    const bildeId = randomUUID();
    await eier.query(
      `INSERT INTO completion_photos (id, completion_id, org_id, filename, original_name, content_type)
       VALUES ($1,$2,$3,$4,'bilde.jpg','image/jpeg')`,
      [bildeId, completionId, orgId, `${randomUUID()}.jpg`],
    );
    return { taskA, taskB, completionId, bildeId };
  }

  it("nekter å hente bildet gjennom en ANNEN oppgaves url", async () => {
    const org = await nyOrg(["tasks"]);
    const { cookie } = await innloggetBruker(org, "visning");
    const { taskB, completionId, bildeId } = await oppsett(org);

    const svar = await hentUtforelsesbilde(
      foresporsel(cookie),
      bildeCtx(org, taskB, completionId, bildeId),
    );
    expect(svar.status).toBe(404);
    expect((await svar.json()).detail).toMatch(/ikke funnet/i);
  });

  it("krever at modulen er på", async () => {
    const org = await nyOrg(["parkering"]);
    const { cookie } = await innloggetBruker(org, "visning");
    const { taskA, completionId, bildeId } = await oppsett(org);

    const svar = await hentUtforelsesbilde(
      foresporsel(cookie),
      bildeCtx(org, taskA, completionId, bildeId),
    );
    expect(svar.status).toBe(403);
  });

  /**
   * Riktig oppgave og riktig lag: da skal ruta komme HELT fram til disken. Fila finnes ikke i
   * testen, og «Fil ikke funnet på disk» er derfor det riktige svaret — det beviser at
   * radoppslaget og alle gatene slapp den gjennom.
   */
  it("slipper gjennom til fila når oppgave, lag og modul stemmer", async () => {
    const org = await nyOrg(["tasks"]);
    const { cookie } = await innloggetBruker(org, "visning");
    const { taskA, completionId, bildeId } = await oppsett(org);

    const svar = await hentUtforelsesbilde(
      foresporsel(cookie),
      bildeCtx(org, taskA, completionId, bildeId),
    );
    expect(svar.status).toBe(404);
    expect((await svar.json()).detail).toMatch(/disk/i);
  });
});
