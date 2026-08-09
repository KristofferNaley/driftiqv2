/**
 * Lagringskvote og filopplasting.
 *
 * Den viktigste testen her er dekningstesten: den slår fast at hver tabell med en
 * `file_size`-kolonne står i `FILTABELLER`. v1 hadde samme krav som en advarsel i prosa,
 * håndhevet av fem ulike routere som måtte huske det. Symptomet ved svikt er stille — en
 * kunde fyller disken mens framdriftslinja står stille — så det er ikke noe som oppdages i
 * bruk. Samme mønster og samme begrunnelse som RLS-dekningstesten.
 */

import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  FILTABELLER,
  MAKS_FILSTORRELSE,
  STANDARD_KVOTE,
  filSti,
  lagreFil,
  lagringsstatus,
  orgKvote,
  orgSti,
  slettFil,
} from "../src/lib/lagring";

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
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
    await rm(path.join(process.env.UPLOAD_DIR ?? "/app/uploads", "orgs", id), {
      recursive: true,
      force: true,
    });
  }
});

async function nyOrg(kvote?: number): Promise<string> {
  const id = `lag-${randomUUID()}`;
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active, storage_quota) VALUES ($1,$2,$3,true,$4)",
    [id, "Lagringslaget", id, kvote ?? null],
  );
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

const fil = (navn: string, type: string, bytes = 100) =>
  new File([new Uint8Array(bytes)], navn, { type });

// ---------------------------------------------------------------------------------------

describe("dekning", () => {
  it("alle tabeller med file_size står i FILTABELLER", async () => {
    // Fanger modulen noen porter om fjorten måneder og glemmer å føre opp. Uten denne
    // testen ville filene deres vært usynlige for kvoten og kunnet fylle disken forbi taket.
    const { rows } = await eier.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'file_size'
      ORDER BY table_name
    `);
    const iBasen = rows.map((r) => r.table_name);
    const mangler = iBasen.filter((t) => !FILTABELLER.includes(t));
    expect(mangler, `Tabeller med file_size som ikke teller mot kvoten: ${mangler}`).toEqual([]);
  });

  it("FILTABELLER peker ikke på tabeller som ikke finnes", async () => {
    // Andre retning: en oppføring uten tabell ville fått summeringen til å kaste ved hver
    // opplasting, i stedet for å telle for lite.
    for (const tabell of FILTABELLER) {
      const { rows } = await eier.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
        [tabell],
      );
      expect(rows.length, `${tabell} står i FILTABELLER, men finnes ikke`).toBe(1);
    }
  });
});

describe("kvote", () => {
  it("bruker standarden når org-en ikke har egen", async () => {
    const org = await nyOrg();
    expect(await i(org, (db) => orgKvote(db, org))).toBe(STANDARD_KVOTE);
  });

  it("bruker org-ens egen kvote når den er satt", async () => {
    const org = await nyOrg(1024 * 1024);
    expect(await i(org, (db) => orgKvote(db, org))).toBe(1024 * 1024);
  });

  it("rapporterer status uten å kaste når ingen filtabeller finnes ennå", async () => {
    const org = await nyOrg();
    const status = await i(org, (db) => lagringsstatus(db, org));
    expect(status.brukt).toBe(0);
    expect(status.prosent).toBe(0);
  });

  it("stopper en opplasting som ikke får plass", async () => {
    const org = await nyOrg(50); // 50 bytes
    const feil = await feilFra(() => i(org, (db) => lagreFil(db, org, "test", fil("a.pdf", "application/pdf", 100))));
    expect(feil.status).toBe(413);
    expect(feil.message).toMatch(/lagringsplassen er brukt opp/i);
  });

  it("skriver ikke fila til disk når kvoten avviser den", async () => {
    // Rekkefølgen er poenget: kvoten sjekkes FØR disken. En avvist fil skal aldri ha vært
    // innom filsystemet.
    const org = await nyOrg(50);
    await feilFra(() => i(org, (db) => lagreFil(db, org, "test", fil("a.pdf", "application/pdf", 100))));
    await expect(stat(orgSti(org, "test"))).rejects.toThrow();
  });
});

describe("validering", () => {
  it("avviser en filtype som ikke er tillatt", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() =>
      i(org, (db) => lagreFil(db, org, "test", fil("ondsinnet.exe", "application/x-msdownload"))),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/støttes ikke/i);
  });

  it("avviser en fil over maksgrensen", async () => {
    const org = await nyOrg();
    const stor = fil("stor.pdf", "application/pdf", MAKS_FILSTORRELSE + 1);
    const feil = await feilFra(() => i(org, (db) => lagreFil(db, org, "test", stor)));
    expect(feil.message).toMatch(/for stor/i);
  });

  it("avviser en tom fil", async () => {
    const org = await nyOrg();
    const feil = await feilFra(() => i(org, (db) => lagreFil(db, org, "test", fil("tom.pdf", "application/pdf", 0))));
    expect(feil.message).toMatch(/tom/i);
  });
});

describe("skriving", () => {
  it("gir fila et uuid-navn og endelse fra typen, ikke fra filnavnet", async () => {
    // Et opplastet «rapport.pdf.exe» skal bli `<uuid>.pdf`. Brukerens navn treffer aldri
    // filsystemet — det beholdes bare som visningsnavn.
    const org = await nyOrg();
    const opplasting = await i(org, (db) =>
      lagreFil(db, org, "docs", fil("rapport.pdf.exe", "application/pdf")),
    );

    expect(opplasting.filnavn).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(opplasting.originalnavn).toBe("rapport.pdf.exe");
    expect(await readFile(opplasting.sti)).toHaveLength(100);
  });

  it("legger fila under org-treet", async () => {
    // ALT en kunde eier skal ligge under én mappe, så sletting ved oppsigelse er én sti.
    const org = await nyOrg();
    const opplasting = await i(org, (db) => lagreFil(db, org, "docs", fil("a.png", "image/png")));
    expect(opplasting.sti).toContain(path.join("orgs", org, "docs"));
  });

  it("sletter fila", async () => {
    const org = await nyOrg();
    const opplasting = await i(org, (db) => lagreFil(db, org, "docs", fil("a.png", "image/png")));
    await slettFil(org, "docs", opplasting.filnavn);
    await expect(stat(opplasting.sti)).rejects.toThrow();
  });

  it("feiler ikke når fila allerede er borte", async () => {
    // Databaseraden er sannheten. En fil som mangler på disk skal ikke hindre kunden i å
    // rydde i sin egen liste.
    const org = await nyOrg();
    await expect(slettFil(org, "docs", `${randomUUID()}.pdf`)).resolves.toBeUndefined();
  });
});

describe("stisikkerhet", () => {
  it("avviser stikomponenter som kan bryte ut av uploads-treet", () => {
    expect(() => orgSti("..", "docs")).toThrow(/ugyldig stikomponent/i);
    expect(() => orgSti("org", "../../etc")).toThrow(/ugyldig stikomponent/i);
    expect(() => orgSti("org/annen", "docs")).toThrow(/ugyldig stikomponent/i);
  });

  it("avviser filnavn med stiseparatorer", () => {
    expect(() => filSti("org", "docs", "../../etc/passwd")).toThrow(/ugyldig filnavn/i);
    expect(() => filSti("org", "docs", "under/mappe.pdf")).toThrow(/ugyldig filnavn/i);
  });
});
