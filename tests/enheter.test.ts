/**
 * Enhetsregisteret — reglene fra v1s `routers/units.py`.
 *
 * Den viktigste her er arkiveringen: en enhet med avvikshistorikk skal aldri kunne
 * forsvinne, og andelsnummeret skal ikke kunne gjenbrukes mens gamle avvik peker hit.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  arkiverEnhet,
  endreEnhet,
  gjenopprettEnhet,
  hentEnheter,
  importerEnheter,
  opprettEnhet,
} from "../src/lib/enheter";

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
    await eier.query("DELETE FROM units WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `enhet-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id,
    "Enhetslaget",
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

describe("identitet", () => {
  it("krever navn på et fellesareal", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() => i(org, (db) => opprettEnhet(db, org, { type: "fellesareal" })));
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/må ha et navn/i);
  });

  it("krever minst ett nummerfelt på en bolig", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() => i(org, (db) => opprettEnhet(db, org, { type: "bolig" })));
    expect(feil.message).toMatch(/andelsnummer, leilighetsnummer eller oppgang/i);
  });

  it("godtar en bolig med bare oppgang", async () => {
    // Sameier uten andelsnummer identifiserer enheten med oppgang + leilighetsnummer.
    const org = await nyOrg();
    const enhet = await i(org, (db) =>
      opprettEnhet(db, org, { type: "bolig", oppgang: "B", leilighetsnr: "H0101" }),
    );
    expect(enhet.oppgang).toBe("B");
  });

  it("hindrer at en delvis endring etterlater en bolig uten identitet", async () => {
    // Valideringen må se den KOMBINERTE tilstanden. Ser den bare det innsendte, kan en
    // oppdatering tømme det siste nummerfeltet uten å bli stoppet.
    const org = await nyOrg();
    const enhet = await i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "12" }));

    const feil = await feilFra(() => i(org, (db) => endreEnhet(db, org, enhet.id, { andelsnr: null })));
    expect(feil.status).toBe(400);
  });
});

describe("kartverket-import", () => {
  it("hopper over enheter som finnes, også dubletter i samme batch", async () => {
    const org = await nyOrg();
    await i(org, (db) => opprettEnhet(db, org, { type: "bolig", leilighetsnr: "H0101", oppgang: "A" }));

    const res = await i(org, (db) =>
      importerEnheter(db, org, [
        { leilighetsnr: "H0101", oppgang: "A", etasje: "1" }, // finnes fra før
        { leilighetsnr: "H0201", oppgang: "A", etasje: "2" },
        { leilighetsnr: "H0201", oppgang: "A", etasje: "2" }, // dublett i batchen
        { leilighetsnr: "H0101", oppgang: "B", etasje: "1" }, // annen oppgang = annen enhet
      ]),
    );
    expect(res).toEqual({ opprettet: 2, hoppetOver: 2 });

    const alle = await i(org, (db) => hentEnheter(db, org));
    expect(alle.length).toBe(3);
    // Importen er idempotent — samme kjøring én gang til oppretter ingenting.
    const igjen = await i(org, (db) =>
      importerEnheter(db, org, [{ leilighetsnr: "H0201", oppgang: "A", etasje: "2" }]),
    );
    expect(igjen).toEqual({ opprettet: 0, hoppetOver: 1 });
  });
});

describe("andelsnummer", () => {
  it("avviser duplikat", async () => {
    const org = await nyOrg();
    await i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "7" }));
    const feil = await feilFra(() => i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "7" })));
    expect(feil.message).toMatch(/finnes allerede/i);
  });

  it("lar en enhet beholde sitt eget nummer ved endring", async () => {
    const org = await nyOrg();
    const enhet = await i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "7" }));
    const endret = await i(org, (db) => endreEnhet(db, org, enhet.id, { andelsnr: "7", etasje: "3" }));
    expect(endret.etasje).toBe("3");
  });

  it("holder nummeret opptatt også når enheten er arkivert", async () => {
    // Gjenbruk ville koblet gamle avvik til feil leilighet.
    const org = await nyOrg();
    const enhet = await i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "9" }));
    await i(org, (db) => arkiverEnhet(db, org, enhet.id));

    const feil = await feilFra(() => i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "9" })));
    expect(feil.message).toMatch(/finnes allerede/i);
  });

  it("tillater samme nummer i en annen org", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await i(a, (db) => opprettEnhet(db, a, { type: "bolig", andelsnr: "1" }));
    const iB = await i(b, (db) => opprettEnhet(db, b, { type: "bolig", andelsnr: "1" }));
    expect(iB.andelsnr).toBe("1");
  });
});

describe("arkivering", () => {
  it("skjuler arkiverte enheter fra standardlisten", async () => {
    const org = await nyOrg();
    const enhet = await i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "3" }));
    await i(org, (db) => arkiverEnhet(db, org, enhet.id));

    expect(await i(org, (db) => hentEnheter(db, org))).toEqual([]);
    expect((await i(org, (db) => hentEnheter(db, org, { medArkiverte: true }))).length).toBe(1);
  });

  it("flytter ikke tidspunktet når en allerede arkivert enhet arkiveres igjen", async () => {
    const org = await nyOrg();
    const enhet = await i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "4" }));
    const forste = await i(org, (db) => arkiverEnhet(db, org, enhet.id));
    const andre = await i(org, (db) => arkiverEnhet(db, org, enhet.id));
    expect(andre.archivedAt).toEqual(forste.archivedAt);
  });

  it("gjenoppretter", async () => {
    const org = await nyOrg();
    const enhet = await i(org, (db) => opprettEnhet(db, org, { type: "bolig", andelsnr: "5" }));
    await i(org, (db) => arkiverEnhet(db, org, enhet.id));
    const tilbake = await i(org, (db) => gjenopprettEnhet(db, org, enhet.id));
    expect(tilbake.archivedAt).toBeNull();
    expect((await i(org, (db) => hentEnheter(db, org))).length).toBe(1);
  });
});
