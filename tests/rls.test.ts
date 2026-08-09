/**
 * Row Level Security — verifiserer at tenantisolasjonen faktisk håndheves av Postgres.
 * Port av `backend/tests/test_rls.py`, pluss de nye testene som dekker v2s egen
 * kontekst-håndheving (`withOrg`).
 *
 * Testene går bevisst utenom Drizzle og applikasjonsfiltrene: en `SELECT *` uten WHERE er
 * nøyaktig det scenarioet RLS skal fange — en spørring som glemte org_id. Går de gjennom
 * ORM-en, tester de ORM-en og ikke policyen.
 *
 * Krever ekte Postgres. Kjøres i v2-containeren:
 *
 *     docker compose -p driftiq-v2 --env-file .env.v2 -f docker-compose.v2.yaml \
 *       exec app npm run test
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  KryssendeOrgKontekst,
  ManglendeOrgKontekst,
  appPool,
  lukkPooler,
  withOrg,
} from "../src/db/client";
import { manglerRls, tenanttabellerUtenDekning } from "../src/db/rls/setup";
import { POLICY_NAVN } from "../src/db/rls/tables";

const DATABASE_URL = process.env.DATABASE_URL!;
const APP_DB_USER = process.env.APP_DB_USER ?? "driftiq_v2_app";

/** Tilkobling som skjemaets eier. Omgår RLS — brukes til oppsett og opprydding. */
let eierPool: Pool;
let eier: PoolClient;

beforeAll(async () => {
  eierPool = new Pool({ connectionString: DATABASE_URL });
  eier = await eierPool.connect();
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

// ---------------------------------------------------------------------------------------
// To ekte organisasjoner med én oppgave hver. Ryddes bort etterpå uansett utfall.
// ---------------------------------------------------------------------------------------

/** Én organisasjon med én leverandør og én oppgave. */
type Org = { id: string; merke: string; vendorId: string; oppgaveId: string };
type Oppsett = { a: Org; b: Org };

const opprettede: string[] = [];

async function opprettOrg(prefiks: string): Promise<Org> {
  const id = `rlstest-${prefiks}-${randomUUID()}`;
  // Merket brukes til å kjenne igjen rader på tvers av tabeller uten å slå opp id-er.
  const merke = id.slice(0, 14);
  const vendorId = randomUUID();
  const oppgaveId = randomUUID();

  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1, $2, $3, true)", [
    id,
    `RLS-test ${merke}`,
    id,
  ]);
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1, $2, $3, true)", [
    vendorId,
    id,
    `Leverandør ${merke}`,
  ]);
  await eier.query(
    "INSERT INTO tasks (id, org_id, vendor_id, title, frequency) VALUES ($1, $2, $3, $4, 'annual')",
    [oppgaveId, id, vendorId, `Oppgave i ${merke}`],
  );

  opprettede.push(id);
  return { id, merke, vendorId, oppgaveId };
}

async function toOrganisasjoner(): Promise<Oppsett> {
  return { a: await opprettOrg("a"), b: await opprettOrg("b") };
}

/** Første rad, eller en forklarende feil. Testene skal ikke tryne på `undefined`. */
function forsteRad<T>(rader: T[], hva: string): T {
  const rad = rader[0];
  if (rad === undefined) throw new Error(`Fant ingen rad for ${hva}`);
  return rad;
}

/**
 * Hele feilkjeden som tekst.
 *
 * Drizzle pakker feil fra driveren inn i sin egen `Failed query: …` og legger originalen på
 * `cause`. Postgres-meldingen vi faktisk vil verifisere («new row violates row-level security
 * policy») ligger altså ett hakk ned. Uten dette ville testen blitt grønn på feil grunnlag —
 * eller, som her, rød selv om policyen gjorde jobben sin.
 */
function feilkjede(e: unknown): string {
  const deler: string[] = [];
  let ledd: unknown = e;
  while (ledd instanceof Error) {
    deler.push(ledd.message);
    ledd = ledd.cause;
  }
  return deler.join(" | ");
}

afterEach(async () => {
  for (const org of opprettede.splice(0)) {
    await eier.query(
      "DELETE FROM task_checklist_items WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [org],
    );
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [org]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [org]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [org]);
  }
});

// ---------------------------------------------------------------------------------------
// Dekning — testene med lengst levetid. De fanger tabellen noen legger til om fjorten måneder.
// ---------------------------------------------------------------------------------------

describe("dekning", () => {
  it("alle forventede tabeller har ENABLE + FORCE RLS", async () => {
    expect(await manglerRls(eier)).toEqual([]);
  });

  it("ingen tenanttabell uten dekning", async () => {
    // En ny tabell med org_id må enten få policy i rls/tables.ts eller føres opp i UNNTATT
    // med grunn. Uten denne testen ville neste modul stille fått en tabell uten isolasjon.
    expect(await tenanttabellerUtenDekning(eier)).toEqual([]);
  });

  it("alle policyer har både USING og WITH CHECK", async () => {
    // Uten WITH CHECK kan man skrive rader INN i en annen organisasjon selv om man ikke kan
    // lese dem — en lekkasje som ikke synes i noen liste.
    const { rows } = await eier.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
       WHERE schemaname = 'public' AND policyname = $1
         AND (qual IS NULL OR with_check IS NULL)`,
      [POLICY_NAVN],
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([]);
  });

  it("approllen eier ingenting og omgår ikke RLS", async () => {
    // FORCE er verdiløst hvis rollen er superbruker eller har BYPASSRLS, og policyene er
    // dekorasjon hvis appen kobler til som tabelleieren.
    const rolle = await eier.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
      [APP_DB_USER],
    );
    const attributter = forsteRad(rolle.rows, `rollen ${APP_DB_USER}`);
    expect(attributter.rolsuper, "Approllen er superbruker og omgår all RLS").toBe(false);
    expect(attributter.rolbypassrls, "Approllen har BYPASSRLS").toBe(false);

    const eide = await eier.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_roles r ON r.oid = c.relowner
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = $1`,
      [APP_DB_USER],
    );
    expect(eide.rows.map((r) => r.relname), "Approllen eier tabeller og omgår sin egen policy").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// Selve mekanismen.
// ---------------------------------------------------------------------------------------

describe("isolasjon", () => {
  it("uten kontekst ser appen ingenting", async () => {
    // Feiler lukket: mangler org-konteksten, er resultatet null rader — ikke alle rader.
    await toOrganisasjoner();
    const klient = await appPool.connect();
    try {
      const { rows } = await klient.query<{ count: string }>("SELECT count(*) FROM tasks");
      const antall = Number(forsteRad(rows, "count(*) FROM tasks").count);
      expect(antall, "Uten org-kontekst slapp det ut rader — RLS feiler åpent").toBe(0);
    } finally {
      klient.release();
    }
  });

  it("org A ser ikke org B", async () => {
    const { a, b } = await toOrganisasjoner();
    const synlige = await withOrg(a.id, async (db) => {
      const res = await db.execute<{ id: string }>("SELECT id FROM tasks" as never);
      return new Set(res.rows.map((r) => r.id));
    });
    expect(synlige.has(a.oppgaveId), "Egen orgs oppgave ble borte — policyen er for streng").toBe(true);
    expect(synlige.has(b.oppgaveId), "Org A så org B sin oppgave — isolasjonen holder ikke").toBe(false);
  });

  it("kan ikke skrive inn i annen org", async () => {
    // WITH CHECK-siden. Uten den kunne man plante rader hos en annen kunde.
    const { a, b } = await toOrganisasjoner();

    const feil = await withOrg(a.id, async (db) => {
      try {
        await db.execute(
          `INSERT INTO tasks (id, org_id, vendor_id, title, frequency)
           VALUES ('${randomUUID()}', '${b.id}', '${b.vendorId}', 'Plantet', 'annual')` as never,
        );
        return null;
      } catch (e) {
        return feilkjede(e);
      }
    });

    expect(feil, "Skrivingen gikk gjennom — WITH CHECK mangler eller er feil").not.toBeNull();
    expect(feil).toMatch(/row-level security/i);
  });

  it("kan ikke endre annen orgs rad", async () => {
    // UPDATE uten org-filter treffer bare egne rader — RLS lukker en del av
    // objektnivå-hullet som bivirkning.
    const { a, b } = await toOrganisasjoner();
    const endret = await withOrg(a.id, async (db) => {
      const res = await db.execute(
        `UPDATE tasks SET title = 'kapret' WHERE id = '${b.oppgaveId}'` as never,
      );
      return res.rowCount;
    });
    expect(endret, "Org A endret org B sin oppgave").toBe(0);
  });

  it("barnetabell isoleres gjennom forelder", async () => {
    // `task_checklist_items` har ingen egen org_id. Uten policy via forelderen ville hele
    // sjekklisten ligget åpen på tvers av kunder.
    const { a, b } = await toOrganisasjoner();
    for (const org of [a, b]) {
      await eier.query(
        'INSERT INTO task_checklist_items (id, task_id, text, "order") VALUES ($1, $2, $3, 0)',
        [randomUUID(), org.oppgaveId, `punkt for ${org.merke}`],
      );
    }

    const punkter = await withOrg(a.id, async (db) => {
      const res = await db.execute<{ text: string }>("SELECT text FROM task_checklist_items" as never);
      return res.rows.map((r) => r.text);
    });

    expect(punkter.some((t) => t.includes(a.merke)), "Egen orgs punkt ble borte").toBe(true);
    expect(punkter.some((t) => t.includes(b.merke)), "Org A leste org B sin sjekkliste").toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// Fella som ellers hadde blitt oppdaget i produksjon.
// ---------------------------------------------------------------------------------------

describe("kontekstens levetid", () => {
  it("konteksten gjelder hele withOrg-blokken", async () => {
    // v1s tilsvarende test het `test_kontekst_overlever_commit` og fanget at lytteren i
    // database.py ble fjernet: `SET LOCAL` forsvinner ved commit, og halve kodebasen gjorde
    // `commit()` etterfulgt av `refresh()`. I v2 er transaksjonen selve arbeidsenheten, så
    // feilmoduset finnes ikke — men testen står igjen som vakthund mot at noen innfører
    // commit inne i `withOrg` og gjenskaper den.
    const { a } = await toOrganisasjoner();
    await withOrg(a.id, async (db) => {
      for (let i = 0; i < 3; i++) {
        const res = await db.execute<{ id: string }>("SELECT id FROM tasks" as never);
        expect(res.rows.map((r) => r.id)).toEqual([a.oppgaveId]);
      }
    });
  });

  it("konteksten lekker ikke mellom kall", async () => {
    // Poolen gjenbruker connections. Hadde konteksten vært satt med en vanlig `SET`, ville
    // den hengt igjen og blitt arvet av neste request — fra et annet borettslag. Det er verre
    // enn ingen RLS, fordi man tror man er trygg.
    const { a } = await toOrganisasjoner();
    await withOrg(a.id, async (db) => db.execute("SELECT count(*) FROM tasks" as never));

    const klient = await appPool.connect(); // henter trolig SAMME connection
    try {
      const { rows } = await klient.query<{ id: string }>("SELECT id FROM tasks");
      expect(
        rows.map((r) => r.id),
        "Org-konteksten hang igjen på en gjenbrukt connection — bruk alltid set_config(..., true)",
      ).toEqual([]);
      expect(rows.map((r) => r.id)).not.toContain(a.oppgaveId);
    } finally {
      klient.release();
    }
  });

  it("ruller tilbake og frigir konteksten når fn kaster", async () => {
    const { a } = await toOrganisasjoner();
    await expect(
      withOrg(a.id, async (db) => {
        await db.execute(
          `INSERT INTO task_checklist_items (id, task_id, text, "order")
           VALUES ('${randomUUID()}', '${a.oppgaveId}', 'skal rulles tilbake', 0)` as never,
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const { rows } = await eier.query<{ count: string }>(
      "SELECT count(*) FROM task_checklist_items WHERE text = 'skal rulles tilbake'",
    );
    const antall = Number(forsteRad(rows, "count(*) FROM task_checklist_items").count);
    expect(antall, "Raden overlevde en kastet withOrg — ingen ROLLBACK").toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// v2-spesifikt: håndhevingen som ikke fantes i v1.
// ---------------------------------------------------------------------------------------

describe("withOrg håndhever kontekst", () => {
  it("avviser tom org-id i stedet for å returnere null rader", async () => {
    // v1s vanligste bug: et endepunkt utenfor /organizations/{org_id}/ fikk ingen kontekst,
    // og hver eneste RLS-tabell svarte null rader uten feilmelding. Her kastes det i stedet.
    await expect(withOrg("", async () => 1)).rejects.toThrow(ManglendeOrgKontekst);
    await expect(withOrg("   ", async () => 1)).rejects.toThrow(ManglendeOrgKontekst);
    await expect(withOrg(undefined as unknown as string, async () => 1)).rejects.toThrow(
      ManglendeOrgKontekst,
    );
  });

  it("avviser nøstet kontekst mot en ANNEN org", async () => {
    // Én forespørsel skal aldri røre to borettslag i samme transaksjon. Skjer det, er det
    // nesten alltid en id som er ført videre feil — og uten denne sjekken ville den indre
    // blokken stille åpnet en ny transaksjon på en ny connection.
    const { a, b } = await toOrganisasjoner();
    await expect(
      withOrg(a.id, async () => {
        return withOrg(b.id, async () => "skulle aldri komme hit");
      }),
    ).rejects.toThrow(KryssendeOrgKontekst);
  });

  it("gjenbruker transaksjonen ved nøsting mot samme org", async () => {
    const { a } = await toOrganisasjoner();
    const resultat = await withOrg(a.id, async () => {
      return withOrg(a.id, async (db) => {
        const res = await db.execute<{ id: string }>("SELECT id FROM tasks" as never);
        return res.rows.map((r) => r.id);
      });
    });
    expect(resultat).toEqual([a.oppgaveId]);
  });
});
