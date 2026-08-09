/**
 * Oppgaver — reglene fra v1s `routers/tasks.py`.
 *
 * Den viktigste testen her er at en sjekklistemal kan byttes ut uten at utført historikk
 * endrer seg. Det er prinsippet «historikk skal ikke kunne endres i ettertid», og det er
 * grunnen til at `completion_checklist_results` har sin egen kopi av teksten.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  deaktiverOppgave,
  endreOppgave,
  erstattSjekkliste,
  hentOppgave,
  hentOppgaver,
  hentUtkvitteringsresultater,
  opprettOppgave,
  registrerUtkvittering,
} from "../src/lib/oppgaver";

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
    await eier.query(
      `DELETE FROM completion_checklist_results WHERE completion_id IN
         (SELECT c.id FROM completions c JOIN tasks t ON t.id = c.task_id WHERE t.org_id = $1)`,
      [id],
    );
    await eier.query(
      "DELETE FROM completions WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [id],
    );
    await eier.query(
      "DELETE FROM task_checklist_items WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM units WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function oppsett() {
  const orgId = `opg-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId,
    "Oppgavelaget",
    orgId,
  ]);
  ryddOrg.push(orgId);

  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Vaktmester',true)", [
    vendorId,
    orgId,
  ]);
  return { orgId, vendorId };
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

const grunn = (vendorId: string) => ({
  vendorId,
  title: "Kontroll av røykvarslere",
  frequency: "annual" as const,
  showOnArshjul: false,
});

describe("oppgaver", () => {
  it("får et qr_token ved opprettelse", async () => {
    // Tokenet er det som trykkes på oppslaget i bygget.
    const { orgId, vendorId } = await oppsett();
    const oppgave = await i(orgId, (db) => opprettOppgave(db, orgId, grunn(vendorId)));
    expect(oppgave.qrToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("beregner forsinket og neste frist uten å lagre dem", async () => {
    const { orgId, vendorId } = await oppsett();
    await i(orgId, (db) =>
      opprettOppgave(db, orgId, { ...grunn(vendorId), startDate: "2020-01-01" }),
    );
    const liste = await i(orgId, (db) => hentOppgaver(db, orgId));
    expect(liste[0]!.forsinket).toBe(true);
    expect(liste[0]!.lastCompletedAt).toBeNull();
  });

  it("avviser en leverandør fra en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const feil = await feilFra(() =>
      i(a.orgId, (db) => opprettOppgave(db, a.orgId, grunn(b.vendorId))),
    );
    expect(feil.status).toBe(404);
    expect(feil.message).toMatch(/leverandør/i);
  });

  it("avviser en enhet fra en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const unitId = randomUUID();
    await eier.query("INSERT INTO units (id, org_id, type, andelsnr) VALUES ($1,$2,'bolig','1')", [
      unitId,
      b.orgId,
    ]);

    const feil = await feilFra(() =>
      i(a.orgId, (db) => opprettOppgave(db, a.orgId, { ...grunn(a.vendorId), unitId })),
    );
    expect(feil.status).toBe(404);
    expect(feil.message).toMatch(/enhet/i);
  });

  it("deaktiverer i stedet for å slette", async () => {
    const { orgId, vendorId } = await oppsett();
    const oppgave = await i(orgId, (db) => opprettOppgave(db, orgId, grunn(vendorId)));
    const deaktivert = await i(orgId, (db) => deaktiverOppgave(db, orgId, oppgave.id));

    expect(deaktivert.active).toBe(false);
    // Fortsatt der — og aldri forsinket, siden den er deaktivert.
    const hentet = await i(orgId, (db) => hentOppgave(db, orgId, oppgave.id));
    expect(hentet.forsinket).toBe(false);
  });
});

describe("utkvittering", () => {
  it("markerer manuell registrering som manual", async () => {
    // Loggen skal vise kilden ærlig, ikke late som den kom fra QR-skjemaet.
    const { orgId, vendorId } = await oppsett();
    const oppgave = await i(orgId, (db) => opprettOppgave(db, orgId, grunn(vendorId)));
    const kvitt = await i(orgId, (db) =>
      registrerUtkvittering(db, orgId, oppgave.id, "Kari", { hasDeviation: false }),
    );
    expect(kvitt.manual).toBe(true);
    expect(kvitt.completedBy).toBe("Kari");
  });

  it("avviser en dato fram i tid", async () => {
    const { orgId, vendorId } = await oppsett();
    const oppgave = await i(orgId, (db) => opprettOppgave(db, orgId, grunn(vendorId)));
    const iMorgen = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const feil = await feilFra(() =>
      i(orgId, (db) =>
        registrerUtkvittering(db, orgId, oppgave.id, "Kari", {
          completedAt: iMorgen,
          hasDeviation: false,
        }),
      ),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/fram i tid/i);
  });

  it("nullstiller forsinkelsen", async () => {
    const { orgId, vendorId } = await oppsett();
    const oppgave = await i(orgId, (db) =>
      opprettOppgave(db, orgId, { ...grunn(vendorId), startDate: "2020-01-01" }),
    );
    expect((await i(orgId, (db) => hentOppgave(db, orgId, oppgave.id))).forsinket).toBe(true);

    await i(orgId, (db) => registrerUtkvittering(db, orgId, oppgave.id, "Kari", { hasDeviation: false }));

    const etter = await i(orgId, (db) => hentOppgave(db, orgId, oppgave.id));
    expect(etter.forsinket).toBe(false);
    expect(etter.lastCompletedAt).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("sjekkliste", () => {
  it("erstatter malen", async () => {
    const { orgId, vendorId } = await oppsett();
    const oppgave = await i(orgId, (db) => opprettOppgave(db, orgId, grunn(vendorId)));

    await i(orgId, (db) =>
      erstattSjekkliste(db, orgId, oppgave.id, { items: [{ text: "Sjekk batteri" }, { text: "Test alarm" }] }),
    );
    const etter = await i(orgId, (db) => hentOppgave(db, orgId, oppgave.id));
    expect(etter.sjekkliste.map((p) => p.text)).toEqual(["Sjekk batteri", "Test alarm"]);
    expect(etter.sjekkliste.map((p) => p.order)).toEqual([0, 1]);
  });

  it("endrer ikke utført historikk når malen byttes", async () => {
    // Kjernen i «historikk skal ikke kunne endres i ettertid». Resultatraden har sin egen
    // kopi av teksten, og itemId er SET NULL — malpunktet kan slettes uten at loggen lyver.
    const { orgId, vendorId } = await oppsett();
    const oppgave = await i(orgId, (db) => opprettOppgave(db, orgId, grunn(vendorId)));
    const mal = await i(orgId, (db) =>
      erstattSjekkliste(db, orgId, oppgave.id, { items: [{ text: "Opprinnelig punkt" }] }),
    );

    const kvitt = await i(orgId, (db) =>
      registrerUtkvittering(db, orgId, oppgave.id, "Kari", { hasDeviation: false }),
    );
    await eier.query(
      `INSERT INTO completion_checklist_results (id, completion_id, item_id, text, checked, "order")
       VALUES ($1,$2,$3,'Opprinnelig punkt',true,0)`,
      [randomUUID(), kvitt.id, mal[0]!.id],
    );

    // Malen byttes helt ut — det gamle punktet slettes.
    await i(orgId, (db) =>
      erstattSjekkliste(db, orgId, oppgave.id, { items: [{ text: "Helt nytt punkt" }] }),
    );

    const historikk = await i(orgId, (db) => hentUtkvitteringsresultater(db, kvitt.id));
    expect(historikk[0]!.text, "Loggen endret seg da malen ble byttet").toBe("Opprinnelig punkt");
    expect(historikk[0]!.checked).toBe(true);
    expect(historikk[0]!.itemId, "Pekeren skal nulles, ikke ta raden med seg").toBeNull();
  });
});
