/**
 * Dokumentarkiv — reglene fra v1s `routers/documents.py`.
 *
 * Mappetreet har flest feller: «slug eller id» betyr at verken `documents.folder` eller
 * `documentFolders.parentId` er fremmednøkler, så alt databasen ellers ville håndhevet —
 * at forelderen finnes, at treet ikke får sykler, at dokumenter ikke blir foreldreløse ved
 * sletting — må gjøres i koden og testes her.
 */

import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  FALLBACK_MAPPE,
  MAKS_DYBDE,
  endreDokument,
  endreMappe,
  grupperPaAar,
  hentDokumenter,
  lastOppDokument,
  opprettMappe,
  slettDokument,
  slettMappe,
} from "../src/lib/dokumenter";
import { bruktLagring, filSti } from "../src/lib/lagring";

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
    await eier.query("DELETE FROM documents WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM document_folders WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
    await rm(path.join(process.env.UPLOAD_DIR ?? "/app/uploads", "orgs", id), {
      recursive: true,
      force: true,
    });
  }
});

async function nyOrg(): Promise<string> {
  const id = `dok-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id,
    "Arkivlaget",
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

const fil = (navn = "referat.pdf", type = "application/pdf", bytes = 200) =>
  new File([new Uint8Array(bytes)], navn, { type });

const dok = (over: Partial<{ title: string; folder: string; documentDate: string | null }> = {}) => ({
  title: "Referat",
  folder: FALLBACK_MAPPE,
  documentDate: null,
  aiReadable: false,
  description: null,
  ...over,
});

describe("mappetreet", () => {
  it("lar en egen mappe ligge inne i en standardmappe", async () => {
    // «Slug eller id»: forelderen kan være en fast slug uten at det finnes en rad for den.
    const org = await nyOrg();
    const m = await i(org, (db) => opprettMappe(db, org, { name: "2026", icon: "📁", parentId: "vedtekter" }));
    expect(m.parentId).toBe("vedtekter");
  });

  it("avviser en forelder som ikke finnes", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() =>
      i(org, (db) => opprettMappe(db, org, { name: "Foreldreløs", icon: "📁", parentId: randomUUID() })),
    );
    expect(feil.status).toBe(404);
  });

  it("avviser en forelder fra en annen org", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const iB = await i(b, (db) => opprettMappe(db, b, { name: "Deres", icon: "📁" }));
    const feil = await feilFra(() =>
      i(a, (db) => opprettMappe(db, a, { name: "Vår", icon: "📁", parentId: iB.id })),
    );
    expect(feil.status).toBe(404);
  });

  it("nekter undermapper i en årsgruppert mappe", async () => {
    // To konkurrerende ordninger i samme mappe ville vært verre enn én.
    const org = await nyOrg();
    const feil = await feilFra(() =>
      i(org, (db) => opprettMappe(db, org, { name: "2026", icon: "📁", parentId: "styrereferater" })),
    );
    expect(feil.message).toMatch(/sorteres automatisk på år/i);
  });

  it(`stopper på ${MAKS_DYBDE} nivåer`, async () => {
    const org = await nyOrg();
    const n1 = await i(org, (db) => opprettMappe(db, org, { name: "Nivå 1", icon: "📁" }));
    const n2 = await i(org, (db) => opprettMappe(db, org, { name: "Nivå 2", icon: "📁", parentId: n1.id }));
    const n3 = await i(org, (db) => opprettMappe(db, org, { name: "Nivå 3", icon: "📁", parentId: n2.id }));

    const feil = await feilFra(() =>
      i(org, (db) => opprettMappe(db, org, { name: "For dypt", icon: "📁", parentId: n3.id })),
    );
    expect(feil.message).toMatch(new RegExp(`maks ${MAKS_DYBDE} nivåer`, "i"));
  });

  it("hindrer at en mappe blir sitt eget opphav", async () => {
    // Uten sykelsjekken ville undertreet blitt koblet fra arkivet og ligget uleselig i basen.
    const org = await nyOrg();
    const forelder = await i(org, (db) => opprettMappe(db, org, { name: "Forelder", icon: "📁" }));
    const barn = await i(org, (db) =>
      opprettMappe(db, org, { name: "Barn", icon: "📁", parentId: forelder.id }),
    );

    const feil = await feilFra(() => i(org, (db) => endreMappe(db, org, forelder.id, { parentId: barn.id })));
    expect(feil.message).toMatch(/inn i seg selv/i);
  });

  it("hindrer at en mappe blir sin egen forelder", async () => {
    const org = await nyOrg();
    const m = await i(org, (db) => opprettMappe(db, org, { name: "Meg selv", icon: "📁" }));
    const feil = await feilFra(() => i(org, (db) => endreMappe(db, org, m.id, { parentId: m.id })));
    expect(feil.message).toMatch(/inn i seg selv/i);
  });
});

describe("sletting av mappe", () => {
  it("flytter dokumentene til «Annet» i stedet for å miste dem", async () => {
    const org = await nyOrg();
    const m = await i(org, (db) => opprettMappe(db, org, { name: "Gammel", icon: "📁" }));
    await i(org, (db) => lastOppDokument(db, org, "Kari", fil(), dok({ folder: m.id })));

    const resultat = await i(org, (db) => slettMappe(db, org, m.id));
    expect(resultat.flyttedeDokumenter).toBe(1);

    const igjen = await i(org, (db) => hentDokumenter(db, org));
    expect(igjen[0]!.folder, "Dokumentet ble hengende i en slettet mappe").toBe(FALLBACK_MAPPE);
  });

  it("tar hele undertreet, ikke bare mappa selv", async () => {
    const org = await nyOrg();
    const rot = await i(org, (db) => opprettMappe(db, org, { name: "Rot", icon: "📁" }));
    const barn = await i(org, (db) => opprettMappe(db, org, { name: "Barn", icon: "📁", parentId: rot.id }));
    await i(org, (db) => lastOppDokument(db, org, "Kari", fil(), dok({ folder: barn.id })));

    const resultat = await i(org, (db) => slettMappe(db, org, rot.id));
    expect(resultat.slettedeMapper).toBe(2);
    expect(resultat.flyttedeDokumenter).toBe(1);
  });
});

describe("dokumenter", () => {
  it("avviser en mappe som ikke finnes", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() =>
      i(org, (db) => lastOppDokument(db, org, "Kari", fil(), dok({ folder: randomUUID() }))),
    );
    expect(feil.status).toBe(404);
  });

  it("teller mot kvoten og lagrer fila", async () => {
    const org = await nyOrg();
    const d = await i(org, (db) => lastOppDokument(db, org, "Kari", fil(), dok()));
    expect(d.uploadedBy).toBe("Kari");
    expect(await i(org, (db) => bruktLagring(db, org))).toBe(200);
    await expect(stat(filSti(org, "documents", d.filename))).resolves.toBeTruthy();
  });

  it("frigjør kvoten og fjerner fila ved sletting", async () => {
    const org = await nyOrg();
    const d = await i(org, (db) => lastOppDokument(db, org, "Kari", fil(), dok()));
    await i(org, (db) => slettDokument(db, org, d.id));

    expect(await i(org, (db) => bruktLagring(db, org))).toBe(0);
    await expect(stat(filSti(org, "documents", d.filename))).rejects.toThrow();
  });

  it("avviser flytting til en mappe som ikke finnes", async () => {
    const org = await nyOrg();
    const d = await i(org, (db) => lastOppDokument(db, org, "Kari", fil(), dok()));
    const feil = await feilFra(() => i(org, (db) => endreDokument(db, org, d.id, { folder: randomUUID() })));
    expect(feil.status).toBe(404);
  });

  it("lar dokumentdatoen rettes i ettertid", async () => {
    // Et gammelt referat kan lastes opp i dag. Datoen er dokumentets egen, ikke opplastingens.
    const org = await nyOrg();
    const d = await i(org, (db) =>
      lastOppDokument(db, org, "Kari", fil(), dok({ documentDate: "2019-01-01" })),
    );
    const rettet = await i(org, (db) => endreDokument(db, org, d.id, { documentDate: "2018-05-04" }));
    expect(rettet.documentDate).toBe("2018-05-04");
  });

  it("sorterer nyeste dokumentdato først, udaterte sist", async () => {
    const org = await nyOrg();
    await i(org, async (db) => {
      await lastOppDokument(db, org, "K", fil(), dok({ title: "Udatert" }));
      await lastOppDokument(db, org, "K", fil(), dok({ title: "Gammel", documentDate: "2020-01-01" }));
      await lastOppDokument(db, org, "K", fil(), dok({ title: "Ny", documentDate: "2026-01-01" }));
    });
    const liste = await i(org, (db) => hentDokumenter(db, org));
    expect(liste.map((d) => d.title)).toEqual(["Ny", "Gammel", "Udatert"]);
  });
});

describe("årsgruppering", () => {
  it("grupperer på dokumentdatoens år og samler udaterte for seg", () => {
    const grupper = grupperPaAar([
      { documentDate: "2026-03-01" },
      { documentDate: "2026-11-01" },
      { documentDate: "2025-01-01" },
      { documentDate: null },
    ]);
    expect(grupper.get("2026")).toBe(2);
    expect(grupper.get("2025")).toBe(1);
    expect(grupper.get("Uten dato")).toBe(1);
  });
});
