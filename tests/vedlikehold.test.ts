/**
 * Vedlikehold — reglene fra v1s `routers/maintenance.py`.
 *
 * Tre ting bærer modulen: FDV-komplettheten (som ikke må kunne jukses til 100 %),
 * enhetsmerket som snapshot, og at et slettet bygningselement ikke drar med seg historikken
 * fra leilighetene.
 */

import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { bruktLagring, filSti } from "../src/lib/lagring";
import {
  FDV_KRAV,
  fdvKomplett,
  garantistatus,
  hentArbeid,
  hentArbeider,
  hentElement,
  kostnaderPerType,
  lastOppFdv,
  leggTilService,
  opprettElement,
  registrerArbeid,
  slettElement,
  slettFdv,
} from "../src/lib/vedlikehold";
import { anonymAktor } from "../src/lib/aktor";

/** Aktøren i testene: navn uten konto. Koblingen til bruker-id testes i aktivitet.test.ts. */
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
    await eier.query("DELETE FROM unit_work_documents WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM unit_works WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM element_documents WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM element_services WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM building_elements WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM units WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
    await rm(path.join(process.env.UPLOAD_DIR ?? "/app/uploads", "orgs", id), {
      recursive: true,
      force: true,
    });
  }
});

async function oppsett() {
  const orgId = `ved-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId,
    "Vedlikeholdslaget",
    orgId,
  ]);
  ryddOrg.push(orgId);

  const unitId = randomUUID();
  await eier.query(
    "INSERT INTO units (id, org_id, type, leilighetsnr, oppgang, andelsnr) VALUES ($1,$2,'bolig','H0203','B','12')",
    [unitId, orgId],
  );
  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Rørlegger',true)", [
    vendorId,
    orgId,
  ]);
  return { orgId, unitId, vendorId };
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

const fil = (navn = "fdv.pdf", bytes = 300) =>
  new File([new Uint8Array(bytes)], navn, { type: "application/pdf" });

const element = { name: "Avløpsrør", icon: "🏗" };

describe("FDV-komplettering", () => {
  it("teller ikke «annet» mot komplettheten", () => {
    // Ellers kunne 100 % nås med seks tilfeldige filer i samlepose-sloten, uten at én
    // eneste av de faktiske kravene var oppfylt.
    expect(fdvKomplett(["annet", "annet", "annet"]).fylt).toBe(0);
    expect(fdvKomplett(FDV_KRAV.slice()).prosent).toBe(100);
  });

  it("teller hver slot bare én gang", () => {
    expect(fdvKomplett(["garanti", "garanti", "garanti"]).fylt).toBe(1);
  });

  it("oppdateres når et dokument lastes opp", async () => {
    const { orgId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    expect((await i(orgId, (db) => hentElement(db, orgId, e.id))).fdv.fylt).toBe(0);

    await i(orgId, (db) => lastOppFdv(db, orgId, e.id, "Kari", fil(), { fdvType: "garanti" }));
    expect((await i(orgId, (db) => hentElement(db, orgId, e.id))).fdv.fylt).toBe(1);
  });

  it("avviser en ukjent FDV-type", async () => {
    const { orgId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    const feil = await feilFra(() =>
      i(orgId, (db) => lastOppFdv(db, orgId, e.id, "Kari", fil(), { fdvType: "oppdiktet" })),
    );
    expect(feil.message).toMatch(/ugyldig fdv-type/i);
  });
});

describe("garanti", () => {
  it("utledes av datoen, aldri lagret", () => {
    // En lagret status ville vært riktig én dag og feil for alltid etterpå.
    const iMorgen = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(garantistatus(iMorgen)).toBe("aktiv");
    expect(garantistatus("2020-01-01")).toBe("utløpt");
    expect(garantistatus(null)).toBe("ukjent");
  });
});

describe("bygningselementer", () => {
  it("avviser en leverandør fra en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const feil = await feilFra(() =>
      i(a.orgId, (db) => opprettElement(db, a.orgId, { ...element, vendorId: b.vendorId })),
    );
    expect(feil.message).toMatch(/ugyldig leverandør/i);
  });

  it("sletter FDV-filene fra disk", async () => {
    const { orgId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    const d = await i(orgId, (db) => lastOppFdv(db, orgId, e.id, "Kari", fil(), { fdvType: "garanti" }));
    expect(await i(orgId, (db) => bruktLagring(db, orgId))).toBe(300);

    await i(orgId, (db) => slettElement(db, orgId, e.id));
    expect(await i(orgId, (db) => bruktLagring(db, orgId))).toBe(0);
    await expect(stat(filSti(orgId, "element_documents", d.filename))).rejects.toThrow();
  });

  it("etterlater enhetsarbeidet når elementet slettes", async () => {
    // SET NULL, ikke CASCADE: arbeidet i leiligheten ble faktisk gjort, uavhengig av
    // hvordan planen senere ble organisert.
    const { orgId, unitId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    const a = await i(orgId, (db) =>
      registrerArbeid(db, orgId, KARI, {
        unitId,
        elementId: e.id,
        workDate: "2026-03-01",
        title: "Byttet sluk",
        category: "annet",
        workType: "vedlikehold",
        paidBy: "borettslag",
      }),
    );

    await i(orgId, (db) => slettElement(db, orgId, e.id));

    const etter = await i(orgId, (db) => hentArbeid(db, orgId, a.id));
    expect(etter.title, "Arbeidet forsvant med bygningselementet").toBe("Byttet sluk");
    expect(etter.elementId).toBeNull();
  });

  it("teller hvor mange enheter som er utført", async () => {
    // «34 av 60 utført» i stedet for ett årstall som skjuler at arbeidet er halvferdig.
    const { orgId, unitId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    await i(orgId, (db) =>
      registrerArbeid(db, orgId, KARI, {
        unitId,
        elementId: e.id,
        workDate: "2026-03-01",
        title: "Sluk",
        category: "annet",
        workType: "vedlikehold",
        paidBy: "borettslag",
      }),
    );
    expect((await i(orgId, (db) => hentElement(db, orgId, e.id))).antallEnhetsarbeider).toBe(1);
  });

  it("sorterer servicehistorikken nyeste først", async () => {
    const { orgId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    await i(orgId, (db) => leggTilService(db, orgId, e.id, { serviceDate: "2024-01-01", title: "Eldst" }));
    await i(orgId, (db) => leggTilService(db, orgId, e.id, { serviceDate: "2026-01-01", title: "Nyest" }));

    const { historikk } = await i(orgId, (db) => hentElement(db, orgId, e.id));
    expect(historikk.map((h) => h.title)).toEqual(["Nyest", "Eldst"]);
  });
});

describe("arbeid i enheter", () => {
  const arbeid = (unitId: string) => ({
    unitId,
    workDate: "2026-03-01",
    title: "Byttet sluk",
    category: "vatrom",
    workType: "vedlikehold" as const,
    paidBy: "borettslag" as const,
  });

  it("kopierer enhetsmerket inn ved registrering", async () => {
    const { orgId, unitId } = await oppsett();
    const a = await i(orgId, (db) => registrerArbeid(db, orgId, KARI, arbeid(unitId)));
    expect(a.unitLabel).toBe("H0203 · oppg. B");
  });

  it("omskriver ikke merket når enheten omnummereres", async () => {
    // Historikk skal ikke kunne endres i ettertid — samme prinsipp som sjekklisteresultater.
    const { orgId, unitId } = await oppsett();
    const a = await i(orgId, (db) => registrerArbeid(db, orgId, KARI, arbeid(unitId)));

    await eier.query("UPDATE units SET leilighetsnr = 'H9999' WHERE id = $1", [unitId]);

    const etter = await i(orgId, (db) => hentArbeid(db, orgId, a.id));
    expect(etter.unitLabel, "Omnummereringen omskrev historikken").toBe("H0203 · oppg. B");
  });

  it("avviser en enhet fra en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const feil = await feilFra(() =>
      i(a.orgId, (db) => registrerArbeid(db, a.orgId, KARI, arbeid(b.unitId))),
    );
    expect(feil.message).toMatch(/ugyldig enhet/i);
  });

  it("filtrerer på enhet", async () => {
    const { orgId, unitId } = await oppsett();
    await i(orgId, (db) => registrerArbeid(db, orgId, KARI, arbeid(unitId)));
    expect((await i(orgId, (db) => hentArbeider(db, orgId, { unitId }))).length).toBe(1);
    expect((await i(orgId, (db) => hentArbeider(db, orgId, { unitId: randomUUID() }))).length).toBe(0);
  });

  it("skiller vedlikehold fra påkostning i kostnadsoppsummeringen", async () => {
    // Skillet avgjør regnskapsføringen: vedlikehold er driftskostnad, påkostning aktiveres.
    const { orgId, unitId } = await oppsett();
    await i(orgId, (db) =>
      registrerArbeid(db, orgId, anonymAktor("K"), { ...arbeid(unitId), cost: 10000 }),
    );
    await i(orgId, (db) =>
      registrerArbeid(db, orgId, anonymAktor("K"), { ...arbeid(unitId), workType: "påkostning", cost: 50000 }),
    );

    const per = await i(orgId, (db) => kostnaderPerType(db, orgId));
    expect(per.find((r) => r.workType === "vedlikehold")?.sum).toBe(10000);
    expect(per.find((r) => r.workType === "påkostning")?.sum).toBe(50000);
  });
});

describe("dokumenter", () => {
  it("frigjør kvoten når et FDV-dokument slettes", async () => {
    const { orgId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    const d = await i(orgId, (db) => lastOppFdv(db, orgId, e.id, "Kari", fil(), { fdvType: "tegninger" }));

    await i(orgId, (db) => slettFdv(db, orgId, e.id, d.id));
    expect(await i(orgId, (db) => bruktLagring(db, orgId))).toBe(0);
  });

  it("bruker filnavnet som tittel når ingen er oppgitt", async () => {
    const { orgId } = await oppsett();
    const e = await i(orgId, (db) => opprettElement(db, orgId, element));
    const d = await i(orgId, (db) =>
      lastOppFdv(db, orgId, e.id, "Kari", fil("Samsvarserklæring.pdf"), { fdvType: "samsvar" }),
    );
    expect(d.title).toBe("Samsvarserklæring.pdf");
  });
});
