/**
 * Kontrakter — reglene fra v1s `routers/contracts.py`, og den første modulen som lagrer filer.
 *
 * Filtestene er viktigere enn de ser ut: det er her lagringskvoten møter en ekte modul for
 * første gang, og der differansen ved erstatning avgjør om en kunde på taket kan bytte ut et
 * vedlegg i det hele tatt.
 */

import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  arkiverKontrakt,
  endreKontrakt,
  gjenopprettKontrakt,
  hentKontrakt,
  hentKontrakter,
  kontraktInn,
  lastOppDokument,
  leggTilPris,
  opprettKontrakt,
  slettDokument,
  slettKontrakt,
  slettPris,
  utlopteAvtaler,
} from "../src/lib/kontrakter";
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
    await eier.query(
      "DELETE FROM contract_price_history WHERE contract_id IN (SELECT id FROM contracts WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM contracts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
    await rm(path.join(process.env.UPLOAD_DIR ?? "/app/uploads", "orgs", id), {
      recursive: true,
      force: true,
    });
  }
});

async function oppsett(kvote?: number) {
  const orgId = `kon-${randomUUID()}`;
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active, storage_quota) VALUES ($1,$2,$3,true,$4)",
    [orgId, "Kontraktlaget", orgId, kvote ?? null],
  );
  ryddOrg.push(orgId);
  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Heisfirma',true)", [
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

const fil = (navn: string, type: string, bytes: number) =>
  new File([new Uint8Array(bytes)], navn, { type });

const grunn = (vendorId: string) => ({ vendorId, title: "Heisservice", aiReadable: false });

describe("kontrakter", () => {
  it("avviser en leverandør fra en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const feil = await feilFra(() => i(a.orgId, (db) => opprettKontrakt(db, a.orgId, grunn(b.vendorId))));
    expect(feil.status).toBe(404);
  });

  it("avviser en forgjenger fra en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const iB = await i(b.orgId, (db) => opprettKontrakt(db, b.orgId, grunn(b.vendorId)));

    const feil = await feilFra(() =>
      i(a.orgId, (db) => opprettKontrakt(db, a.orgId, { ...grunn(a.vendorId), predecessorId: iB.id })),
    );
    expect(feil.message).toMatch(/avtalen som fornyes/i);
  });

  it("nuller ikke forgjengeren ved vanlig lagring", async () => {
    // predecessorId er ikke med i redigeringsskjemaet. Var den det, ville hver lagring
    // nullet koblingen til avtalen som ble erstattet.
    const { orgId, vendorId } = await oppsett();
    const gammel = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    const fornyet = await i(orgId, (db) =>
      opprettKontrakt(db, orgId, { ...grunn(vendorId), predecessorId: gammel.id }),
    );

    await i(orgId, (db) => endreKontrakt(db, orgId, fornyet.id, { title: "Heisservice 2027" }));

    const etter = await i(orgId, (db) => hentKontrakt(db, orgId, fornyet.id));
    expect(etter.predecessorId).toBe(gammel.id);
  });

  it("deler ikke dokumentet med AI-rådgiveren som standard", async () => {
    // Den som ikke tar stilling, deler ingenting — avtaler kan inneholde kommersielle vilkår.
    const { orgId, vendorId } = await oppsett();
    // Går gjennom skjemaet, så det er Zod-standarden som testes og ikke en verdi jeg satte.
    const k = await i(orgId, (db) =>
      opprettKontrakt(db, orgId, kontraktInn.parse({ vendorId, title: "Avtale" })),
    );
    expect(k.aiReadable).toBe(false);
  });
});

describe("arkivering", () => {
  it("skjuler arkiverte fra standardlisten, men sletter aldri", async () => {
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    await i(orgId, (db) => arkiverKontrakt(db, orgId, k.id, { archiveNote: "Sagt opp" }));

    expect((await i(orgId, (db) => hentKontrakter(db, orgId, { arkiverte: false }))).length).toBe(0);
    expect((await i(orgId, (db) => hentKontrakter(db, orgId, { arkiverte: true }))).length).toBe(1);
    expect((await i(orgId, (db) => hentKontrakt(db, orgId, k.id))).archiveNote).toBe("Sagt opp");
  });

  it("gjenoppretter og fjerner notatet", async () => {
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    await i(orgId, (db) => arkiverKontrakt(db, orgId, k.id, { archiveNote: "Feil" }));
    const tilbake = await i(orgId, (db) => gjenopprettKontrakt(db, orgId, k.id));
    expect(tilbake.archivedAt).toBeNull();
    expect(tilbake.archiveNote).toBeNull();
  });

  it("teller en utløpt avtale som utløpt til den arkiveres", async () => {
    // «Åpen til den lukkes» — samme mønster som Oppgaver og Avvik.
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) =>
      opprettKontrakt(db, orgId, { ...grunn(vendorId), endDate: "2020-01-01" }),
    );
    expect((await i(orgId, (db) => utlopteAvtaler(db, orgId))).length).toBe(1);

    await i(orgId, (db) => arkiverKontrakt(db, orgId, k.id, {}));
    expect((await i(orgId, (db) => utlopteAvtaler(db, orgId))).length).toBe(0);
  });
});

describe("avtaledokument", () => {
  it("lagrer fila og teller den mot kvoten", async () => {
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));

    const etter = await i(orgId, (db) =>
      lastOppDokument(db, orgId, k.id, fil("avtale.pdf", "application/pdf", 500)),
    );
    expect(etter.fileOriginalName).toBe("avtale.pdf");
    expect(etter.fileSize).toBe(500);
    expect(await i(orgId, (db) => bruktLagring(db, orgId))).toBe(500);
    await expect(stat(filSti(orgId, "contracts", etter.fileName!))).resolves.toBeTruthy();
  });

  it("avviser en filtype som ikke er en avtale", async () => {
    // Kontrakter tillater bare PDF, PNG og JPG — snevrere enn standarden i lagring.ts.
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    const feil = await feilFra(() =>
      i(orgId, (db) =>
        lastOppDokument(db, orgId, k.id, fil("notat.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 100)),
      ),
    );
    expect(feil.message).toMatch(/støttes ikke/i);
  });

  it("teller bare differansen når fila erstattes", async () => {
    // Uten dette kunne en kunde på taket aldri byttet ut et vedlegg med et like stort.
    const { orgId, vendorId } = await oppsett(1000);
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    await i(orgId, (db) => lastOppDokument(db, orgId, k.id, fil("v1.pdf", "application/pdf", 900)));

    // 900 av 1000 brukt. En ny fil på 900 ville sprengt kvoten hvis hele telles.
    const etter = await i(orgId, (db) =>
      lastOppDokument(db, orgId, k.id, fil("v2.pdf", "application/pdf", 900)),
    );
    expect(etter.fileOriginalName).toBe("v2.pdf");
    expect(await i(orgId, (db) => bruktLagring(db, orgId))).toBe(900);
  });

  it("rydder opp den gamle fila ved erstatning", async () => {
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    const forste = await i(orgId, (db) =>
      lastOppDokument(db, orgId, k.id, fil("v1.pdf", "application/pdf", 100)),
    );
    await i(orgId, (db) => lastOppDokument(db, orgId, k.id, fil("v2.pdf", "application/pdf", 100)));

    await expect(stat(filSti(orgId, "contracts", forste.fileName!))).rejects.toThrow();
  });

  it("sletter fila og frigjør kvoten", async () => {
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    const med = await i(orgId, (db) =>
      lastOppDokument(db, orgId, k.id, fil("avtale.pdf", "application/pdf", 400)),
    );

    const uten = await i(orgId, (db) => slettDokument(db, orgId, k.id));
    expect(uten.fileName).toBeNull();
    expect(await i(orgId, (db) => bruktLagring(db, orgId))).toBe(0);
    await expect(stat(filSti(orgId, "contracts", med.fileName!))).rejects.toThrow();
  });

  it("stopper en opplasting som sprenger kvoten", async () => {
    const { orgId, vendorId } = await oppsett(300);
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    const feil = await feilFra(() =>
      i(orgId, (db) => lastOppDokument(db, orgId, k.id, fil("stor.pdf", "application/pdf", 500))),
    );
    expect(feil.status).toBe(413);
  });
});

describe("prishistorikk", () => {
  it("setter nyeste pris som avtalens årssum", async () => {
    // To tall som sier ulike ting om samme avtale ville vært verre enn ett.
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) =>
      opprettKontrakt(db, orgId, { ...grunn(vendorId), annualSum: 10000 }),
    );

    await i(orgId, (db) => leggTilPris(db, orgId, k.id, { effectiveDate: "2026-01-01", annualSum: 12000 }));
    await i(orgId, (db) => leggTilPris(db, orgId, k.id, { effectiveDate: "2025-01-01", annualSum: 11000 }));

    const etter = await i(orgId, (db) => hentKontrakt(db, orgId, k.id));
    expect(etter.annualSum, "Eldre pris overstyrte den nyeste").toBe(12000);
    expect(etter.prishistorikk.map((p) => p.annualSum)).toEqual([12000, 11000]);
  });

  it("regner årssummen på nytt når nyeste pris slettes", async () => {
    // Uten omregningen ble summen stående på prisen som nettopp ble fjernet.
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    await i(orgId, (db) => leggTilPris(db, orgId, k.id, { effectiveDate: "2025-01-01", annualSum: 11000 }));
    const nyeste = await i(orgId, (db) =>
      leggTilPris(db, orgId, k.id, { effectiveDate: "2026-01-01", annualSum: 12000 }),
    );

    await i(orgId, (db) => slettPris(db, orgId, k.id, nyeste.id));

    const etter = await i(orgId, (db) => hentKontrakt(db, orgId, k.id));
    expect(etter.annualSum).toBe(11000);
  });

  it("lar årssummen stå når siste prisoppføring slettes", async () => {
    // Summen kan være satt direkte på avtalen, uten historikk — den skal ikke nulles.
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) =>
      opprettKontrakt(db, orgId, { ...grunn(vendorId), annualSum: 10000 }),
    );
    const eneste = await i(orgId, (db) =>
      leggTilPris(db, orgId, k.id, { effectiveDate: "2026-01-01", annualSum: 12000 }),
    );

    await i(orgId, (db) => slettPris(db, orgId, k.id, eneste.id));

    const etter = await i(orgId, (db) => hentKontrakt(db, orgId, k.id));
    expect(etter.annualSum).toBe(12000);
    expect(etter.prishistorikk).toEqual([]);
  });
});

describe("sletting", () => {
  it("sletter avtalen med prishistorikk og fil, og frigjør kvoten", async () => {
    const { orgId, vendorId } = await oppsett();
    const k = await i(orgId, (db) => opprettKontrakt(db, orgId, grunn(vendorId)));
    await i(orgId, (db) => leggTilPris(db, orgId, k.id, { effectiveDate: "2026-01-01", annualSum: 12000 }));
    const medFil = await i(orgId, (db) =>
      lastOppDokument(db, orgId, k.id, fil("avtale.pdf", "application/pdf", 500)),
    );

    await i(orgId, (db) => slettKontrakt(db, orgId, k.id));

    const feil = await feilFra(() => i(orgId, (db) => hentKontrakt(db, orgId, k.id)));
    expect(feil.status).toBe(404);
    await expect(stat(filSti(orgId, "contracts", medFil.fileName!))).rejects.toThrow();
    expect(await i(orgId, (db) => bruktLagring(db, orgId))).toBe(0);
  });

  it("sletter ikke en avtale i en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const iB = await i(b.orgId, (db) => opprettKontrakt(db, b.orgId, grunn(b.vendorId)));

    const feil = await feilFra(() => i(a.orgId, (db) => slettKontrakt(db, a.orgId, iB.id)));
    expect(feil.status).toBe(404);
  });
});
