/**
 * Rutiner og HMS-maler.
 *
 * Rutiner har to særegenheter: statusen REGNES UT (så revisjonsvarselet ikke kan slås av ved
 * å sette den manuelt), og versjonshistorikken tas FØR endringen skrives. Malene er
 * plattformdata og nås utenfor org-konteksten.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg, withoutRls } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  effektivStatus,
  endreRutine,
  hentRutine,
  hentViaQr,
  markerGjennomgatt,
  opprettRutine,
} from "../src/lib/rutiner";
import {
  endreMal,
  hentMal,
  hentStandardmal,
  leggTilKategori,
  leggTilPunkt,
  opprettMal,
  slettMal,
} from "../src/lib/maler";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddMal: string[] = [];

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
    await eier.query("DELETE FROM routine_versions WHERE org_id = $1", [id]);
    await eier.query(
      "DELETE FROM routine_steps WHERE routine_id IN (SELECT id FROM routines WHERE org_id = $1)",
      [id],
    );
    await eier.query("DELETE FROM routines WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendor_contacts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddMal.splice(0)) {
    await eier.query("DELETE FROM hms_templates WHERE id = $1", [id]);
  }
});

async function oppsett() {
  const orgId = `rut-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId,
    "Rutinelaget",
    orgId,
  ]);
  ryddOrg.push(orgId);

  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Vaktmester',true)", [
    vendorId,
    orgId,
  ]);
  await eier.query(
    "INSERT INTO vendor_contacts (id, org_id, vendor_id, name, phone, is_primary) VALUES ($1,$2,$3,'Ola','99887766',true)",
    [randomUUID(), orgId, vendorId],
  );
  return { orgId, vendorId };
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);
const p = <T>(fn: Parameters<typeof withoutRls<T>>[1]) => withoutRls("plattformpanel", fn);

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    return e as ApiFeil;
  }
  throw new Error("Forventet en feil, men kallet gikk gjennom");
}

function dagerSiden(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const rutine = { title: "Ved vannlekkasje", isCritical: true, status: "publisert" as const };

describe("effektiv status", () => {
  it("er utkast så lenge rutinen er det", () => {
    expect(effektivStatus({ status: "utkast", reviewIntervalMonths: 12, lastReviewedAt: null })).toBe("utkast");
  });

  it("er aktiv når påminnelsen er slått av", () => {
    // NULL-intervall = kunden har valgt bort varselet. Da skal rutinen aldri flagges.
    expect(
      effektivStatus({ status: "publisert", reviewIntervalMonths: null, lastReviewedAt: null }),
    ).toBe("aktiv");
  });

  it("trenger gjennomgang når den aldri er gjennomgått", () => {
    expect(
      effektivStatus({ status: "publisert", reviewIntervalMonths: 12, lastReviewedAt: null }),
    ).toBe("trenger_gjennomgang");
  });

  it("trenger gjennomgang når intervallet er passert", () => {
    expect(
      effektivStatus({ status: "publisert", reviewIntervalMonths: 12, lastReviewedAt: dagerSiden(400) }),
    ).toBe("trenger_gjennomgang");
    expect(
      effektivStatus({ status: "publisert", reviewIntervalMonths: 12, lastReviewedAt: dagerSiden(100) }),
    ).toBe("aktiv");
  });

  it("nullstilles av en gjennomgang", async () => {
    const { orgId } = await oppsett();
    const r = await i(orgId, (db) =>
      opprettRutine(db, orgId, { ...rutine, reviewIntervalMonths: 12 }),
    );
    expect(r.effektivStatus).toBe("trenger_gjennomgang");

    const etter = await i(orgId, (db) => markerGjennomgatt(db, orgId, r.id));
    expect(etter.effektivStatus).toBe("aktiv");
  });
});

describe("versjonshistorikk", () => {
  it("tar snapshot av tilstanden FØR endringen", async () => {
    // Ved tilsyn må styret kunne vise hvilken rutine som gjaldt på et gitt tidspunkt. Tas
    // snapshotet etterpå, dokumenterer det den nye teksten og ikke den gamle.
    const { orgId } = await oppsett();
    const r = await i(orgId, (db) =>
      opprettRutine(db, orgId, { ...rutine, title: "Opprinnelig tittel" }),
    );

    await i(orgId, (db) => endreRutine(db, orgId, r.id, "Kari", { title: "Ny tittel" }));

    const etter = await i(orgId, (db) => hentRutine(db, orgId, r.id));
    expect(etter.title).toBe("Ny tittel");
    expect(etter.version).toBe(2);
    expect(etter.versjoner).toHaveLength(1);

    const snapshot = JSON.parse(etter.versjoner[0]!.contentSnapshot);
    expect(snapshot.title, "Snapshotet fanget den NYE teksten").toBe("Opprinnelig tittel");
    expect(etter.versjoner[0]!.changedBy).toBe("Kari");
  });

  it("tar med stegene i snapshotet", async () => {
    const { orgId } = await oppsett();
    const r = await i(orgId, (db) =>
      opprettRutine(db, orgId, { ...rutine, steps: [{ title: "Steng hovedkran", isCritical: true }] }),
    );
    await i(orgId, (db) => endreRutine(db, orgId, r.id, "Kari", { steps: [{ title: "Noe helt annet", isCritical: false }] }));

    const etter = await i(orgId, (db) => hentRutine(db, orgId, r.id));
    const snapshot = JSON.parse(etter.versjoner[0]!.contentSnapshot);
    expect(snapshot.steps[0].title).toBe("Steng hovedkran");
    expect(etter.steg[0]!.title).toBe("Noe helt annet");
  });
});

describe("steg med kontaktinfo", () => {
  it("løser «contact» live mot leverandørens primærkontakt", async () => {
    // Kontaktinfo hentes fra Leverandører-modulen, ikke fryses i teksten.
    const { orgId, vendorId } = await oppsett();
    const r = await i(orgId, (db) =>
      opprettRutine(db, orgId, {
        ...rutine,
        vendorId,
        steps: [{ title: "Ring vaktmester", isCritical: false, calloutType: "contact" }],
      }),
    );
    expect(r.steg[0]!.kontakt?.phone).toBe("99887766");
  });

  it("viser det NYE nummeret etter at leverandøren har byttet", async () => {
    const { orgId, vendorId } = await oppsett();
    const r = await i(orgId, (db) =>
      opprettRutine(db, orgId, {
        ...rutine,
        vendorId,
        steps: [{ title: "Ring vaktmester", isCritical: false, calloutType: "contact" }],
      }),
    );
    await eier.query("UPDATE vendor_contacts SET phone = '11223344' WHERE vendor_id = $1", [vendorId]);

    const etter = await i(orgId, (db) => hentRutine(db, orgId, r.id));
    expect(etter.steg[0]!.kontakt?.phone, "Kontaktinfoen var frosset i steget").toBe("11223344");
  });

  it("lagrer ikke tekst på et contact-steg", async () => {
    // Lagret tekst ville blitt liggende og bli feil neste gang kontaktpersonen byttes.
    const { orgId, vendorId } = await oppsett();
    const r = await i(orgId, (db) =>
      opprettRutine(db, orgId, {
        ...rutine,
        vendorId,
        steps: [{ title: "Ring", isCritical: false, calloutType: "contact", calloutText: "Ola, 99887766" }],
      }),
    );
    expect(r.steg[0]!.calloutText).toBeNull();
  });
});

describe("offentlig visning via QR", () => {
  it("viser en publisert rutine", async () => {
    const { orgId } = await oppsett();
    const r = await i(orgId, (db) => opprettRutine(db, orgId, rutine));
    const offentlig = await p((db) => hentViaQr(db, r.qrToken!));
    expect(offentlig.title).toBe("Ved vannlekkasje");
  });

  it("viser ikke et utkast", async () => {
    // Et utkast som henger på veggen ville vært verre enn ingen rutine.
    const { orgId } = await oppsett();
    const r = await i(orgId, (db) => opprettRutine(db, orgId, { ...rutine, status: "utkast" }));
    expect((await feilFra(() => p((db) => hentViaQr(db, r.qrToken!)))).status).toBe(404);
  });
});

describe("HMS-maler", () => {
  async function nyMal(over: Partial<{ isDefault: boolean; name: string }> = {}) {
    const m = await p((db) =>
      opprettMal(db, {
        templateType: "vernerunde",
        name: over.name ?? `Mal ${randomUUID().slice(0, 8)}`,
        isDefault: over.isDefault ?? false,
        active: true,
      }),
    );
    ryddMal.push(m.id);
    return m;
  }

  it("har bare én standardmal per type", async () => {
    const a = await nyMal({ isDefault: true });
    const b = await nyMal({ isDefault: true });

    const { rows } = await eier.query<{ id: string }>(
      "SELECT id FROM hms_templates WHERE template_type = 'vernerunde' AND is_default = true",
    );
    expect(rows.map((r) => r.id)).toEqual([b.id]);
    expect(a.id).not.toBe(b.id);
  });

  it("nekter å deaktivere standardmalen", async () => {
    // Uten den ville typen stått uten standard, og kunde-appen fått noe vilkårlig.
    const m = await nyMal({ isDefault: true });
    const feil = await feilFra(() => p((db) => endreMal(db, m.id, { active: false })));
    expect(feil.message).toMatch(/kan ikke deaktiveres/i);
  });

  it("nekter å slette standardmalen", async () => {
    const m = await nyMal({ isDefault: true });
    const feil = await feilFra(() => p((db) => slettMal(db, m.id)));
    expect(feil.message).toMatch(/kan ikke slettes/i);
  });

  it("bygger malen med kategorier og punkter i rekkefølge", async () => {
    const m = await nyMal();
    const k = await p((db) => leggTilKategori(db, m.id, { key: "brann", label: "Brannvern", order: 0 }));
    await p((db) => leggTilPunkt(db, k.id, { text: "Sjekk slokkeapparat", order: 1 }));
    await p((db) => leggTilPunkt(db, k.id, { text: "Sjekk rømningsvei", order: 0 }));

    const full = await p((db) => hentMal(db, m.id));
    expect(full.kategorier).toHaveLength(1);
    expect(full.kategorier[0]!.punkter.map((x) => x.text)).toEqual([
      "Sjekk rømningsvei",
      "Sjekk slokkeapparat",
    ]);
  });

  it("arver templateType til kategorien fra malen", async () => {
    const m = await nyMal();
    const k = await p((db) => leggTilKategori(db, m.id, { key: "el", label: "El-sikkerhet", order: 0 }));
    expect(k.templateType).toBe("vernerunde");
  });

  it("faller tilbake på eldste aktive når ingen er merket som standard", async () => {
    // Ellers ville en glemt flaggsetting gitt kunden en tom spørsmålsliste, og vernerunden
    // sett ut som om den ikke hadde noen punkter.
    await eier.query("UPDATE hms_templates SET is_default = false WHERE template_type = 'risikovurdering'");
    const m = await p((db) =>
      opprettMal(db, { templateType: "risikovurdering", name: "Uten flagg", isDefault: false, active: true }),
    );
    ryddMal.push(m.id);

    const standard = await p((db) => hentStandardmal(db, "risikovurdering"));
    expect(standard.id).toBeTruthy();
  });
});
