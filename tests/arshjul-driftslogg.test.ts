/**
 * Årshjul og Driftslogg — forretningsreglene fra v1s `routers/arshjul.py` og
 * `routers/driftslogg.py`.
 *
 * RLS-dekningen for `annual_events` og `log_entries` testes automatisk av `rls.test.ts`.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { endreHendelse, hentHendelser, opprettHendelse, slettHendelse } from "../src/lib/arshjul";
import { hentDriftsloggSamlet, hentLogg, opprettLogg, slettLogg } from "../src/lib/driftslogg";
import { anonymAktor } from "../src/lib/aktor";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];

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
    await eier.query("DELETE FROM annual_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM log_entries WHERE org_id = $1", [id]);
    // Kildene til den samlede loggen — settes inn av testene under.
    await eier.query(
      "DELETE FROM completions WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM deviations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `hjul-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id,
    "Hjullaget",
    id,
  ]);
  ryddOrg.push(id);
  return id;
}

async function nyLeverandor(orgId: string): Promise<string> {
  const id = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Vaktmester',true)", [
    id,
    orgId,
  ]);
  return id;
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    return e as ApiFeil;
  }
  throw new Error("Forventet en feil, men kallet gikk gjennom");
}

describe("årshjul", () => {
  const grunn = { title: "Dugnad", category: "dugnad" as const, isRecurring: false };

  it("lister sortert på dato", async () => {
    const org = await nyOrg();
    await i(org, async (db) => {
      await opprettHendelse(db, org, { ...grunn, title: "Høst", eventDate: "2026-10-01" });
      await opprettHendelse(db, org, { ...grunn, title: "Vår", eventDate: "2026-04-01" });
    });
    const liste = await i(org, (db) => hentHendelser(db, org));
    expect(liste.map((h) => h.title)).toEqual(["Vår", "Høst"]);
  });

  it("avviser startdato etter fristen", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() =>
      i(org, (db) =>
        opprettHendelse(db, org, { ...grunn, startDate: "2026-06-01", eventDate: "2026-05-01" }),
      ),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/etter fristen/i);
  });

  it("validerer den kombinerte tilstanden ved endring", async () => {
    // En oppdatering som BARE flytter fristen kan legge den foran en eksisterende startdato.
    // Valideres kun det innsendte, slipper den gjennom og perioden blir negativ.
    const org = await nyOrg();
    const h = await i(org, (db) =>
      opprettHendelse(db, org, { ...grunn, startDate: "2026-05-01", eventDate: "2026-06-01" }),
    );

    const feil = await feilFra(() => i(org, (db) => endreHendelse(db, org, h.id, { eventDate: "2026-04-01" })));
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/etter fristen/i);
  });

  it("tillater å fjerne startdatoen", async () => {
    const org = await nyOrg();
    const h = await i(org, (db) =>
      opprettHendelse(db, org, { ...grunn, startDate: "2026-05-01", eventDate: "2026-06-01" }),
    );
    const endret = await i(org, (db) => endreHendelse(db, org, h.id, { startDate: null }));
    expect(endret.startDate).toBeNull();
  });

  it("gir 404 på ukjent hendelse", async () => {
    const org = await nyOrg();
    expect((await feilFra(() => i(org, (db) => slettHendelse(db, org, randomUUID())))).status).toBe(404);
  });
});

describe("driftslogg", () => {
  it("kopierer forfatternavnet inn i raden", async () => {
    // Navnet skal ikke være en peker: bytter noen navn, eller slettes brukeren, skal loggen
    // fortsatt vise hvem som førte den.
    const org = await nyOrg();
    const rad = await i(org, (db) =>
      opprettLogg(db, org, anonymAktor("Kari Nordmann"), { title: "Skiftet lyspære", entryDate: "2026-08-01" }),
    );
    expect(rad.createdBy).toBe("Kari Nordmann");
  });

  it("lister nyeste først", async () => {
    const org = await nyOrg();
    await i(org, async (db) => {
      await opprettLogg(db, org, anonymAktor("A"), { title: "Eldst", entryDate: "2026-01-01" });
      await opprettLogg(db, org, anonymAktor("A"), { title: "Nyest", entryDate: "2026-08-01" });
    });
    const liste = await i(org, (db) => hentLogg(db, org));
    expect(liste.map((r) => r.title)).toEqual(["Nyest", "Eldst"]);
  });

  it("tar med leverandørnavnet", async () => {
    const org = await nyOrg();
    const vendorId = await nyLeverandor(org);
    await i(org, (db) =>
      opprettLogg(db, org, anonymAktor("A"), { title: "Service", entryDate: "2026-08-01", vendorId }),
    );
    const liste = await i(org, (db) => hentLogg(db, org));
    expect(liste[0]!.vendorName).toBe("Vaktmester");
  });

  it("avviser en leverandør fra en annen org", async () => {
    // Fremmednøkler til leverandører må peke inn i SAMME org, ellers lekker data på tvers.
    const a = await nyOrg();
    const b = await nyOrg();
    const vendorB = await nyLeverandor(b);

    const feil = await feilFra(() =>
      i(a, (db) => opprettLogg(db, a, anonymAktor("A"), { title: "Tyveri", entryDate: "2026-08-01", vendorId: vendorB })),
    );
    expect(feil.status).toBe(404);
  });

  it("gir 404 på ukjent loggføring", async () => {
    const org = await nyOrg();
    expect((await feilFra(() => i(org, (db) => slettLogg(db, org, randomUUID())))).status).toBe(404);
  });
});

describe("samlet driftslogg", () => {
  it("fletter kildene og teller per kilde", async () => {
    const orgId = await nyOrg();
    const vendorId = await nyLeverandor(orgId);

    // En utkvittert oppgave, et meldt+lukket avvik og et notat — tre kilder, fire poster.
    const taskId = randomUUID();
    await eier.query(
      `INSERT INTO tasks (id, org_id, vendor_id, title, frequency, active)
       VALUES ($1,$2,$3,'Trappevask','weekly',true)`,
      [taskId, orgId, vendorId],
    );
    await eier.query(
      "INSERT INTO completions (id, task_id, completed_by) VALUES ($1,$2,'Vaskefirma AS')",
      [randomUUID(), taskId],
    );
    await eier.query(
      `INSERT INTO deviations (id, org_id, number, title, status, reported_by, resolved_at, resolved_by, resolution_notes)
       VALUES ($1,$2,22,'Løs list i trappen','lukket','Kari Nordmann',now(),'Ola Hansen','Skrudd fast')`,
      [randomUUID(), orgId],
    );
    await i(orgId, (db) =>
      opprettLogg(db, orgId, anonymAktor("Tore"), {
        title: "Byttet lyspære",
        entryDate: "2026-08-01",
      }),
    );

    const logg = await i(orgId, (db) => hentDriftsloggSamlet(db, orgId));

    expect(logg.antall).toMatchObject({ oppgave: 1, avvik: 2, manuelt: 1, vedlikehold: 0 });
    expect(logg.poster.map((p) => p.kilde).sort()).toEqual(["avvik", "avvik", "manuelt", "oppgave"]);

    const fullfort = logg.poster.find((p) => p.kilde === "oppgave")!;
    expect(fullfort.tittel).toBe("Trappevask fullført");
    expect(fullfort.vendorName).toBe("Vaktmester");
    expect(fullfort.aktor).toBe("Kvittert av Vaskefirma AS");

    // Meldt og lukket er TO punkter på tidslinja — avstanden mellom dem er informasjonen.
    const lukket = logg.poster.find((p) => p.tittel.startsWith("Avvik #022 lukket"))!;
    expect(lukket.tekst).toBe("Skrudd fast");
    expect(lukket.aktor).toBe("Lukket av Ola Hansen");
  });

  it("krysser ikke org-grensen", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await i(b, (db) =>
      opprettLogg(db, b, anonymAktor("Kari"), { title: "Bare i B", entryDate: "2026-08-01" }),
    );

    const ut = await i(a, (db) => hentDriftsloggSamlet(db, a));
    expect(ut.poster).toEqual([]);
  });

  it("etterregistrerte notater får dato uten klokkeslett", async () => {
    // Ført i dag om noe som skjedde i forrige uke: et klokkeslett ville vært diktet.
    const orgId = await nyOrg();
    await i(orgId, (db) =>
      opprettLogg(db, orgId, anonymAktor("Tore"), { title: "Gammel jobb", entryDate: "2026-07-01" }),
    );
    const iDag = new Date().toISOString().slice(0, 10);
    await i(orgId, (db) =>
      opprettLogg(db, orgId, anonymAktor("Tore"), { title: "Fersk jobb", entryDate: iDag }),
    );

    const ut = await i(orgId, (db) => hentDriftsloggSamlet(db, orgId));
    expect(ut.poster.find((p) => p.tittel === "Gammel jobb")!.visKlokke).toBe(false);
    expect(ut.poster.find((p) => p.tittel === "Fersk jobb")!.visKlokke).toBe(true);
  });
});
