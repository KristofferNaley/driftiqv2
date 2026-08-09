/**
 * Den anonyme QR-flyten.
 *
 * Dette er den eneste skrivbare flaten i systemet UTEN innlogging, og den eneste der en
 * feil rammer noe fysisk: QR-kodene henger på heisen og sprinklersentralen, og de kan ikke
 * «rulles tilbake». Testene dekker derfor de tre egenskapene som må holde:
 *
 *  1. Tokenet er tilgangskontrollen — feil eller inaktivt token gir ingenting.
 *  2. Sjekklisten KOPIERES, og punkter som ikke er huket av føres som ikke utført.
 *  3. Avvik meldt via QR får løpenummer og arver org-en fra OPPGAVEN.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { hentQrKontekst, registrerViaQr } from "../src/lib/qr";

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
    await eier.query("DELETE FROM deviations WHERE org_id = $1", [id]);
    await eier.query(
      "DELETE FROM completions WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [id],
    );
    await eier.query(
      "DELETE FROM task_checklist_items WHERE task_id IN (SELECT id FROM tasks WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

/** Org + leverandør + oppgave med QR-token og tre sjekkpunkter. */
async function oppsett(opts: { aktiv?: boolean } = {}) {
  const orgId = `qr-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId,
    "Testlaget",
    orgId,
  ]);
  ryddOrg.push(orgId);

  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name) VALUES ($1,$2,'Heis-Service AS')", [
    vendorId,
    orgId,
  ]);

  const taskId = randomUUID();
  const token = randomUUID();
  await eier.query(
    `INSERT INTO tasks (id, org_id, vendor_id, title, frequency, qr_token, active, start_date)
     VALUES ($1,$2,$3,'Heiskontroll','annual',$4,$5,current_date)`,
    [taskId, orgId, vendorId, token, opts.aktiv ?? true],
  );

  const punkter: string[] = [];
  for (const [i, tekst] of ["Nødtelefon", "Dørblad", "Nødlys"].entries()) {
    const id = randomUUID();
    punkter.push(id);
    await eier.query(
      'INSERT INTO task_checklist_items (id, task_id, text, "order") VALUES ($1,$2,$3,$4)',
      [id, taskId, tekst, i],
    );
  }
  return { orgId, taskId, token, punkter, vendorId };
}

const feilFra = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    throw new Error("forventet en feil");
  } catch (e) {
    return e as ApiFeil;
  }
};

describe("hentQrKontekst", () => {
  it("gir oppgaven, leverandøren og sjekklista for et gyldig token", async () => {
    const { token } = await oppsett();
    const k = await hentQrKontekst(token);
    expect(k.tittel).toBe("Heiskontroll");
    expect(k.leverandor).toBe("Heis-Service AS");
    expect(k.sjekkliste.map((p) => p.text)).toEqual(["Nødtelefon", "Dørblad", "Nødlys"]);
  });

  it("svarer 404 på et ukjent token", async () => {
    const feil = await feilFra(() => hentQrKontekst(randomUUID()));
    expect(feil.status).toBe(404);
  });

  it("svarer 404 når oppgaven er deaktivert", async () => {
    // Å sette en oppgave på pause skal faktisk stenge QR-koden som henger ute.
    const { token } = await oppsett({ aktiv: false });
    const feil = await feilFra(() => hentQrKontekst(token));
    expect(feil.status).toBe(404);
  });
});

describe("registrerViaQr", () => {
  it("kopierer sjekklista og fører ikke-avhukede punkter som ikke utført", async () => {
    const { token, punkter } = await oppsett();
    await registrerViaQr(token, {
      completedBy: "Ola",
      hasDeviation: false,
      checkedItemIds: [punkter[0]!, punkter[2]!],
    });

    const { rows } = await eier.query<{ text: string; checked: boolean }>(
      `SELECT r.text, r.checked FROM completion_checklist_results r
       JOIN completions c ON c.id = r.completion_id
       JOIN tasks t ON t.id = c.task_id
       WHERE t.qr_token = $1 ORDER BY r."order"`,
      [token],
    );
    // «Ikke utført» og «ikke spurt om» er ulike ting i en internkontrollperm — derfor må
    // ALLE tre punktene ligge der, ikke bare de to som ble huket av.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.checked)).toEqual([true, false, true]);
  });

  it("fører leverandørselskapet når navn ikke er oppgitt", async () => {
    // Loggen skal aldri stå tom for hvem som utførte; leverandøren er avtaleparten.
    const { token } = await oppsett();
    await registrerViaQr(token, { hasDeviation: false, checkedItemIds: [] });
    const { rows } = await eier.query<{ completed_by: string; manual: boolean }>(
      "SELECT c.completed_by, c.manual FROM completions c JOIN tasks t ON t.id = c.task_id WHERE t.qr_token = $1",
      [token],
    );
    expect(rows[0]!.completed_by).toBe("Heis-Service AS");
    // Loggen skal vise ærlig at dette kom fra QR-koden, ikke fra styret i appen.
    expect(rows[0]!.manual).toBe(false);
  });

  it("oppretter avvik MED løpenummer og org fra oppgaven", async () => {
    const { token, orgId } = await oppsett();
    await registrerViaQr(token, {
      completedBy: "Ola",
      hasDeviation: true,
      deviationDescription: "Nødlys ute",
      severity: "akutt",
      checkedItemIds: [],
    });

    const { rows } = await eier.query<{
      number: number | null;
      org_id: string;
      title: string;
      severity: string | null;
      reported_by: string;
    }>("SELECT number, org_id, title, severity, reported_by FROM deviations WHERE org_id = $1", [
      orgId,
    ]);
    expect(rows).toHaveLength(1);
    // I v1 ble QR-avvik opprettet UTEN nummer — de sto uten i lista og var umulige å finne
    // igjen med nummersøk.
    expect(rows[0]!.number).toBe(1);
    expect(rows[0]!.org_id).toBe(orgId);
    expect(rows[0]!.title).toBe("Nødlys ute");
    expect(rows[0]!.severity).toBe("akutt");
    expect(rows[0]!.reported_by).toBe("Ola");
  });

  it("teller løpenummeret videre fra org-ens eksisterende avvik", async () => {
    const { token, orgId } = await oppsett();
    await eier.query(
      `INSERT INTO deviations (id, org_id, number, title, reported_by, status)
       VALUES ($1,$2,7,'Eldre sak','Kari','ny')`,
      [randomUUID(), orgId],
    );
    await registrerViaQr(token, { hasDeviation: true, deviationDescription: "Ny", checkedItemIds: [] });
    const { rows } = await eier.query<{ number: number }>(
      "SELECT number FROM deviations WHERE org_id = $1 ORDER BY number DESC LIMIT 1",
      [orgId],
    );
    expect(rows[0]!.number).toBe(8);
  });

  it("oppretter ingenting på et ukjent token", async () => {
    const feil = await feilFra(() =>
      registrerViaQr(randomUUID(), { hasDeviation: true, checkedItemIds: [] }),
    );
    expect(feil.status).toBe(404);
  });
});
