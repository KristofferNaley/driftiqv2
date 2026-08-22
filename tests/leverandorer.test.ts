/**
 * Leverandører — reglene fra v1s `routers/vendors.py`.
 *
 * To ting bærer denne modulen: at sletting ikke kan dra en serviceavtale med seg, og at det
 * bare finnes én primærkontakt om gangen.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  endreKontakt,
  endreLeverandor,
  hentLeverandor,
  hentLeverandorer,
  leggTilAdgang,
  leggTilKontakt,
  leggTilNotat,
  opprettLeverandor,
  slettKontakt,
  slettLeverandor,
} from "../src/lib/leverandorer";
import { anonymAktor } from "../src/lib/aktor";

const KARI = anonymAktor("Kari");

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
    await eier.query("DELETE FROM contracts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendor_notes WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendor_access_items WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendor_contacts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `lev-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id,
    "Leverandørlaget",
    id,
  ]);
  ryddOrg.push(id);
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

const grunn = { name: "Heisfirma AS", relationshipType: "avtale" as const, ehf: false, active: true };

describe("leverandøren", () => {
  it("filtrerer på aktive", async () => {
    const org = await nyOrg();
    await i(org, (db) => opprettLeverandor(db, org, grunn));
    await i(org, (db) => opprettLeverandor(db, org, { ...grunn, name: "Nedlagt", active: false }));

    expect((await i(org, (db) => hentLeverandorer(db, org, { aktive: true }))).length).toBe(1);
    expect((await i(org, (db) => hentLeverandorer(db, org))).length).toBe(2);
  });

  it("ser ikke leverandører fra en annen org", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await i(b, (db) => opprettLeverandor(db, b, grunn));
    expect(await i(a, (db) => hentLeverandorer(db, a))).toEqual([]);
  });
});

describe("duplikatvern på org.nr.", () => {
  it("avviser samme org.nr. to ganger i samme org, og navngir den eksisterende", async () => {
    const org = await nyOrg();
    await i(org, (db) => opprettLeverandor(db, org, { ...grunn, orgNumber: "962109535" }));

    const feil = await feilFra(() =>
      i(org, (db) => opprettLeverandor(db, org, { ...grunn, name: "Samme firma igjen", orgNumber: "962109535" })),
    );
    expect(feil.status).toBe(409);
    expect(feil.message).toContain("Heisfirma AS");
  });

  it("tillater samme org.nr. i en annen org", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await i(a, (db) => opprettLeverandor(db, a, { ...grunn, orgNumber: "962109535" }));
    await expect(
      i(b, (db) => opprettLeverandor(db, b, { ...grunn, orgNumber: "962109535" })),
    ).resolves.toBeTruthy();
  });

  it("stopper også endring til et opptatt org.nr. — men ikke lagring av eget", async () => {
    const org = await nyOrg();
    await i(org, (db) => opprettLeverandor(db, org, { ...grunn, orgNumber: "962109535" }));
    const annen = await i(org, (db) => opprettLeverandor(db, org, { ...grunn, name: "Rørlegger AS" }));

    const feil = await feilFra(() =>
      i(org, (db) => endreLeverandor(db, org, annen.id, { orgNumber: "962109535" })),
    );
    expect(feil.status).toBe(409);

    // Å lagre leverandøren på nytt med sitt EGET nummer skal selvsagt gå bra.
    const forste = await i(org, (db) => hentLeverandorer(db, org));
    const heis = forste.find((l) => l.name === "Heisfirma AS")!;
    await expect(
      i(org, (db) => endreLeverandor(db, org, heis.id, { orgNumber: "962109535", notes: "oppdatert" })),
    ).resolves.toBeTruthy();
  });

  it("bryr seg ikke om leverandører uten org.nr.", async () => {
    const org = await nyOrg();
    await i(org, (db) => opprettLeverandor(db, org, grunn));
    await expect(
      i(org, (db) => opprettLeverandor(db, org, { ...grunn, name: "Enda en uten nummer" })),
    ).resolves.toBeTruthy();
  });
});

describe("sletting", () => {
  it("blokkeres av en aktiv oppgave", async () => {
    // Alternativet ville vært kaskade — og da forsvinner oppgaver fordi noen ryddet i
    // leverandørlista. Meldingen sier hva som må gjøres først.
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    await eier.query(
      "INSERT INTO tasks (id, org_id, vendor_id, title, frequency, qr_token) VALUES ($1,$2,$3,'Service','annual',$4)",
      [randomUUID(), org, lev.id, randomUUID()],
    );

    const feil = await feilFra(() => i(org, (db) => slettLeverandor(db, org, lev.id)));
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/1 oppgave/i);
  });

  it("blokkeres også av en deaktivert oppgave, med forklaring", async () => {
    // v1 telte bare aktive oppgaver, men fremmednøkkelen stoppet slettingen uansett — med
    // en 500 fra databasen. Her skal svaret være det samme som utfallet.
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    await eier.query(
      "INSERT INTO tasks (id, org_id, vendor_id, title, frequency, qr_token, active) VALUES ($1,$2,$3,'Gammel','annual',$4,false)",
      [randomUUID(), org, lev.id, randomUUID()],
    );

    const feil = await feilFra(() => i(org, (db) => slettLeverandor(db, org, lev.id)));
    expect(feil.status, "Databasen ville uansett nektet — svaret må si det").toBe(400);
    expect(feil.message).toMatch(/inkludert deaktiverte/i);
  });

  it("blokkeres av en kontrakt", async () => {
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    await eier.query("INSERT INTO contracts (id, org_id, vendor_id, title) VALUES ($1,$2,$3,'Avtale')", [
      randomUUID(),
      org,
      lev.id,
    ]);

    const feil = await feilFra(() => i(org, (db) => slettLeverandor(db, org, lev.id)));
    expect(feil.message).toMatch(/1 kontrakt —/i);
  });

  it("tar med kontakter, adgang og notater", async () => {
    // Disse har ingen verdi uten leverandøren, i motsetning til oppgaver og kontrakter.
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    await i(org, (db) => leggTilKontakt(db, org, lev.id, { name: "Ola", isPrimary: true }));
    await i(org, (db) => leggTilAdgang(db, org, lev.id, { title: "Nøkkel 12", status: "utlevert" }, KARI));
    await i(org, (db) => leggTilNotat(db, org, lev.id, "Kari", { text: "Ringte" }));

    await i(org, (db) => slettLeverandor(db, org, lev.id));

    const { rows } = await eier.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM vendor_contacts WHERE vendor_id = $1)
            + (SELECT count(*) FROM vendor_access_items WHERE vendor_id = $1)
            + (SELECT count(*) FROM vendor_notes WHERE vendor_id = $1) AS n`,
      [lev.id],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("kontaktpersoner", () => {
  it("har bare én primærkontakt om gangen", async () => {
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    await i(org, (db) => leggTilKontakt(db, org, lev.id, { name: "Først", isPrimary: true }));
    await i(org, (db) => leggTilKontakt(db, org, lev.id, { name: "Deretter", isPrimary: true }));

    const { kontakter } = await i(org, (db) => hentLeverandor(db, org, lev.id));
    expect(kontakter.filter((k) => k.isPrimary).map((k) => k.name)).toEqual(["Deretter"]);
  });

  it("mister ikke sitt eget merke når den settes som primær på nytt", async () => {
    // `fjernAndrePrimaere` må utelate kontakten som settes — ellers nulles merket den
    // nettopp fikk, i samme kall.
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    const k = await i(org, (db) => leggTilKontakt(db, org, lev.id, { name: "Ola", isPrimary: true }));

    const endret = await i(org, (db) =>
      endreKontakt(db, org, lev.id, k.id, { isPrimary: true, role: "Daglig leder" }),
    );
    expect(endret.isPrimary).toBe(true);
    expect(endret.role).toBe("Daglig leder");
  });

  it("sorterer primærkontakten først", async () => {
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    await i(org, (db) => leggTilKontakt(db, org, lev.id, { name: "Vanlig", isPrimary: false }));
    await i(org, (db) => leggTilKontakt(db, org, lev.id, { name: "Primær", isPrimary: true }));

    const { kontakter } = await i(org, (db) => hentLeverandor(db, org, lev.id));
    expect(kontakter[0]!.name).toBe("Primær");
  });

  it("gir 404 på en kontakt hos en annen leverandør", async () => {
    const org = await nyOrg();
    const a = await i(org, (db) => opprettLeverandor(db, org, grunn));
    const b = await i(org, (db) => opprettLeverandor(db, org, { ...grunn, name: "Annen" }));
    const k = await i(org, (db) => leggTilKontakt(db, org, b.id, { name: "Deres", isPrimary: false }));

    expect((await feilFra(() => i(org, (db) => slettKontakt(db, org, a.id, k.id)))).status).toBe(404);
  });
});

describe("notater", () => {
  it("kopierer forfatternavnet inn og viser nyeste først", async () => {
    const org = await nyOrg();
    const lev = await i(org, (db) => opprettLeverandor(db, org, grunn));
    await i(org, (db) => leggTilNotat(db, org, lev.id, "Kari", { text: "Første" }));
    await i(org, (db) => leggTilNotat(db, org, lev.id, "Ola", { text: "Andre" }));

    const { notater } = await i(org, (db) => hentLeverandor(db, org, lev.id));
    expect(notater[0]!.text).toBe("Andre");
    expect(notater[0]!.authorName).toBe("Ola");
  });
});
