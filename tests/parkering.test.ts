/**
 * Parkering — forretningsreglene fra v1s `routers/parking.py`, og at modulen faktisk er
 * dekket av tenantisolasjonen.
 *
 * Merk at RLS-dekningen for de tre nye tabellene testes automatisk av `rls.test.ts`
 * («ingen tenanttabell uten dekning»). Det er hele poenget med den testen: en ny modul kan
 * ikke få tabeller uten policy uten at suiten blir rød.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { ApiFeil } from "../src/lib/api";
import {
  avsluttAvtale,
  plassInn,
  endrePlass,
  hentAvtaler,
  hentPlasser,
  hentVenteliste,
  leggPaVenteliste,
  opprettAvtale,
  opprettPlass,
  slettFraVenteliste,
  slettPlass,
} from "../src/lib/parkering";

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
    await eier.query("DELETE FROM parking_leases WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM parking_waitlist WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM parking_spots WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `park-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id,
    "Parkeringslaget",
    id,
  ]);
  ryddOrg.push(id);
  return id;
}

/** Kjører modulfunksjonene med org-kontekst, slik rutelaget gjør. */
const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiFeil) return e;
    throw e;
  }
  throw new Error("Forventet en ApiFeil, men kallet gikk gjennom");
}

describe("eierskapsformene", () => {
  // Produksjonsdata har v1s tre former — migrasjonen kopierer 1:1, så enum-en må romme
  // dem. Første utkast hadde «felles»/«privat» og avviste hver migrerte tinglyste plass.
  it("plassInn godtar v1s tinglyst og seksjon", () => {
    for (const eierskap of ["tinglyst", "seksjon", "felles"] as const) {
      const r = plassInn.safeParse({ number: "T-1", ownershipType: eierskap });
      expect(r.success).toBe(true);
    }
    expect(plassInn.safeParse({ number: "T-1", ownershipType: "privat" }).success).toBe(false);
  });
});


describe("plasser", () => {
  it("oppretter og lister sortert på nummer", async () => {
    const org = await nyOrg();
    await i(org, async (db) => {
      await opprettPlass(db, org, { number: "12", ownershipType: "felles", spotType: "standard", status: "ledig" });
      await opprettPlass(db, org, { number: "03", ownershipType: "felles", spotType: "lading", status: "ledig" });
    });

    const plasser = await i(org, (db) => hentPlasser(db, org));
    expect(plasser.map((p) => p.number)).toEqual(["03", "12"]);
    expect(plasser[0]!.lease).toBeNull();
  });

  it("avviser duplikat plassnummer", async () => {
    const org = await nyOrg();
    await i(org, (db) =>
      opprettPlass(db, org, { number: "7", ownershipType: "felles", spotType: "standard", status: "ledig" }),
    );

    const feil = await feilFra(() =>
      i(org, (db) =>
        opprettPlass(db, org, { number: "7", ownershipType: "felles", spotType: "standard", status: "ledig" }),
      ),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/finnes allerede/i);
  });

  it("tillater å endre en plass uten å endre nummeret", async () => {
    // Duplikatsjekken ved endring må bare slå inn når nummeret FAKTISK endres — ellers ville
    // en plass kollidert med seg selv og blitt umulig å redigere.
    const org = await nyOrg();
    const plass = await i(org, (db) =>
      opprettPlass(db, org, { number: "5", ownershipType: "felles", spotType: "standard", status: "ledig" }),
    );

    const endret = await i(org, (db) =>
      endrePlass(db, org, plass.id, { number: "5", holderName: "Nytt navn" }),
    );
    expect(endret.holderName).toBe("Nytt navn");
  });

  it("gir 404 på ukjent plass i stedet for stille no-op", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() => i(org, (db) => slettPlass(db, org, randomUUID())));
    expect(feil.status).toBe(404);
  });

  it("ser ikke plasser fra en annen org", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await i(b, (db) =>
      opprettPlass(db, b, { number: "99", ownershipType: "felles", spotType: "standard", status: "ledig" }),
    );

    expect(await i(a, (db) => hentPlasser(db, a))).toEqual([]);
  });
});

describe("leieavtaler", () => {
  async function plassMedAvtale() {
    const org = await nyOrg();
    const plass = await i(org, (db) =>
      opprettPlass(db, org, { number: "1", ownershipType: "felles", spotType: "standard", status: "ledig" }),
    );
    const avtale = await i(org, (db) =>
      opprettAvtale(db, org, { spotId: plass.id, tenantName: "Leietaker", pricePerMonth: 800 }),
    );
    return { org, plass, avtale };
  }

  it("setter plassen til utleid når avtalen opprettes", async () => {
    const { org, plass } = await plassMedAvtale();
    const plasser = await i(org, (db) => hentPlasser(db, org));
    expect(plasser.find((p) => p.id === plass.id)?.status).toBe("utleid");
    expect(plasser.find((p) => p.id === plass.id)?.lease?.tenantName).toBe("Leietaker");
  });

  it("avviser en ny avtale på en plass som allerede er utleid", async () => {
    const { org, plass } = await plassMedAvtale();
    const feil = await feilFra(() =>
      i(org, (db) =>
        opprettAvtale(db, org, { spotId: plass.id, tenantName: "Nummer to", pricePerMonth: 900 }),
      ),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/allerede en aktiv leieavtale/i);
  });

  it("frigjør plassen når avtalen avsluttes", async () => {
    const { org, plass, avtale } = await plassMedAvtale();
    await i(org, (db) => avsluttAvtale(db, org, avtale.id));

    const plasser = await i(org, (db) => hentPlasser(db, org));
    expect(plasser.find((p) => p.id === plass.id)?.status).toBe("ledig");
    expect(await i(org, (db) => hentAvtaler(db, org))).toEqual([]);
  });

  it("rører ikke en plass som styret har tatt til eget bruk", async () => {
    // Sto plassen som «disponert», har styret overtatt den. Da skal en avsluttet avtale
    // ikke stille gjøre den utleiebar igjen.
    const { org, plass, avtale } = await plassMedAvtale();
    await i(org, (db) => endrePlass(db, org, plass.id, { status: "disponert" }));
    await i(org, (db) => avsluttAvtale(db, org, avtale.id));

    const plasser = await i(org, (db) => hentPlasser(db, org));
    expect(plasser.find((p) => p.id === plass.id)?.status).toBe("disponert");
  });

  it("avviser avtale på en plass i en annen org", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const plassB = await i(b, (db) =>
      opprettPlass(db, b, { number: "1", ownershipType: "felles", spotType: "standard", status: "ledig" }),
    );

    const feil = await feilFra(() =>
      i(a, (db) => opprettAvtale(db, a, { spotId: plassB.id, tenantName: "Tyv", pricePerMonth: 1 })),
    );
    expect(feil.status).toBe(404);
  });
});

describe("venteliste", () => {
  it("setter dagens dato når den ikke er oppgitt", async () => {
    const org = await nyOrg();
    const rad = await i(org, (db) =>
      leggPaVenteliste(db, org, { name: "Interessert", requestedType: "standard" }),
    );
    expect(rad.requestedAt).toBe(new Date().toISOString().slice(0, 10));
  });

  it("lister sortert på ønsket dato", async () => {
    const org = await nyOrg();
    await i(org, async (db) => {
      await leggPaVenteliste(db, org, { name: "Sist", requestedType: "standard", requestedAt: "2026-05-01" });
      await leggPaVenteliste(db, org, { name: "Først", requestedType: "standard", requestedAt: "2026-01-01" });
    });
    const liste = await i(org, (db) => hentVenteliste(db, org));
    expect(liste.map((r) => r.name)).toEqual(["Først", "Sist"]);
  });

  it("gir 404 på ukjent oppføring", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() => i(org, (db) => slettFraVenteliste(db, org, randomUUID())));
    expect(feil.status).toBe(404);
  });
});
