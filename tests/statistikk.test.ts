/**
 * Statistikken i plattformpanelet (`hentStatistikk`) — ny i v2 etter statistikk-v3-mockupen,
 * ikke en v1-port. Tyngdepunktet er demo-regelen: demo-kunder skal FINNES i `kunder`-lista
 * (med flagget satt, panelet filtrerer), men holdes utenfor de databaseaggregerte tallene —
 * ukesaktiviteten og modulbruken. En salgsdemo som blåser opp brukstallene er verre enn
 * ingen statistikk.
 *
 * Testbasen deles med annen data, så testene sammenligner FØR og ETTER egne innsettinger i
 * stedet for å anta absolutte tall.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import { hentStatistikk } from "../src/lib/plattform";

let eierPool: Pool;
let ekteOrg: string;
let demoOrg: string;
const ryddLeads: string[] = [];
const ryddAvvik: string[] = [];
let kontraktId: string | null = null;
let brukerId: string;

const stat = () => withoutRls("plattformpanel", (db) => hentStatistikk(db));

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  ekteOrg = randomUUID();
  demoOrg = randomUUID();
  brukerId = randomUUID();
  await eierPool.query(
    "INSERT INTO organizations (id, name, slug, active, demo, unit_count, enabled_modules) VALUES ($1,$2,$3,true,false,44,$4)",
    [ekteOrg, "Statistikktest Ekte", `st-ekte-${ekteOrg.slice(0, 8)}`, JSON.stringify(["tasks", "avvik"])],
  );
  await eierPool.query(
    "INSERT INTO organizations (id, name, slug, active, demo, unit_count) VALUES ($1,$2,$3,true,true,80)",
    [demoOrg, "Statistikktest Demo", `st-demo-${demoOrg.slice(0, 8)}`],
  );
  await eierPool.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at, last_login_at)
     VALUES ($1, $2, $3, 'member', true, true, now(), now(), now())`,
    [brukerId, "Statistikkbruker", `${brukerId}@driftiq.test`],
  );
  await eierPool.query(
    "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'orgadmin')",
    [randomUUID(), brukerId, ekteOrg],
  );
});

afterAll(async () => {
  for (const id of ryddAvvik) await eierPool.query("DELETE FROM deviations WHERE id = $1", [id]);
  for (const id of ryddLeads) await eierPool.query("DELETE FROM leads WHERE id = $1", [id]);
  if (kontraktId) await eierPool.query("DELETE FROM platform_contracts WHERE id = $1", [kontraktId]);
  await eierPool.query("DELETE FROM user_org_memberships WHERE user_id = $1", [brukerId]);
  await eierPool.query("DELETE FROM users WHERE id = $1", [brukerId]);
  await eierPool.query("DELETE FROM organizations WHERE id = $1", [ekteOrg]);
  await eierPool.query("DELETE FROM organizations WHERE id = $1", [demoOrg]);
  await eierPool.end();
  await lukkPooler();
});

async function nyttAvvik(orgId: string) {
  const id = randomUUID();
  await eierPool.query(
    "INSERT INTO deviations (id, org_id, title, reported_by) VALUES ($1,$2,'Statistikktest','Test')",
    [id, orgId],
  );
  ryddAvvik.push(id);
  return id;
}

describe("demo-regelen", () => {
  it("demo-kunden står i kunder-lista med flagget satt", async () => {
    const s = await stat();
    const demo = s.kunder.find((k) => k.id === demoOrg);
    const ekte = s.kunder.find((k) => k.id === ekteOrg);
    expect(demo?.demo).toBe(true);
    expect(ekte?.demo).toBe(false);
    // Innloggingen fra oppsettet telles på den ekte kunden.
    expect(ekte?.brukere).toBe(1);
    expect(ekte?.aktive30).toBe(1);
  });

  it("hendelser fra demo-kunder holdes utenfor ukesaktiviteten — ekte teller", async () => {
    const sumFor = (await stat()).ukesaktivitet.reduce((n, u) => n + u.n, 0);

    await nyttAvvik(demoOrg);
    const etterDemo = (await stat()).ukesaktivitet.reduce((n, u) => n + u.n, 0);
    expect(etterDemo).toBe(sumFor);

    await nyttAvvik(ekteOrg);
    const etterEkte = (await stat()).ukesaktivitet.reduce((n, u) => n + u.n, 0);
    expect(etterEkte).toBe(sumFor + 1);
  });

  it("modulbruk teller den ekte kunden, ikke demo-kunden", async () => {
    // Avvikene fra forrige test ligger inne: ett hos demo, ett hos ekte.
    const s = await stat();
    const avvik = s.moduler.find((m) => m.nokkel === "avvik");
    expect(avvik).toBeDefined();
    expect(avvik!.aktivert).toBeGreaterThanOrEqual(1);
    expect(avvik!.brukt).toBeGreaterThanOrEqual(1);
    // hendelser30 i kunder-lista teller derimot per kunde — også demo (flagget avgjør visning).
    expect(s.kunder.find((k) => k.id === demoOrg)?.hendelser30).toBe(1);
    expect(s.kunder.find((k) => k.id === ekteOrg)?.hendelser30).toBe(1);
  });
});

describe("avtale og modulinntekt", () => {
  it("årssum, avtalestart og alias-normalisert modulinntekt", async () => {
    const forVedlikehold = (await stat()).moduler.find((m) => m.nokkel === "vedlikehold")!.inntekt;

    kontraktId = randomUUID();
    await eierPool.query(
      `INSERT INTO platform_contracts (id, org_id, base_fee, modules, discount_percent, start_date)
       VALUES ($1, $2, 10000, $3, 10, '2026-05-01')`,
      // «vedlikeholdsplan» er v1-nøkkelen — skal normaliseres til dagens «vedlikehold».
      [kontraktId, ekteOrg, JSON.stringify([{ key: "vedlikeholdsplan", price: 5000 }])],
    );

    const s = await stat();
    const ekte = s.kunder.find((k) => k.id === ekteOrg);
    // (10 000 + 5 000) minus 10 % rabatt.
    expect(ekte?.arssum).toBe(13500);
    expect(ekte?.avtaleStart).toBe("2026-05-01");
    const vedlikehold = s.moduler.find((m) => m.nokkel === "vedlikehold")!;
    // Modulprisen telles uten rabatt — det er modulens pris som er poenget.
    expect(vedlikehold.inntekt).toBe(forVedlikehold + 5000);
  });
});

describe("trakten", () => {
  it("teller kohorten på dagens status — «minst kommet dit»", async () => {
    const forTrakt = (await stat()).trakt;

    for (const status of ["ny", "kontaktet", "konvertert"]) {
      const id = randomUUID();
      await eierPool.query(
        "INSERT INTO leads (id, name, email, status) VALUES ($1, $2, $3, $4)",
        [id, "Traktlead", `${id}@driftiq.test`, status],
      );
      ryddLeads.push(id);
    }

    const t = (await stat()).trakt;
    expect(t.leads).toBe(forTrakt.leads + 3);
    expect(t.kontaktet).toBe(forTrakt.kontaktet + 2);
    expect(t.kvalifisert).toBe(forTrakt.kvalifisert + 1);
    expect(t.kunder).toBe(forTrakt.kunder + 1);
  });
});
