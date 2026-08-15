/**
 * Innmeldinger («Meld feil») — ikke en v1-port: trådloggingen av statusendringer og
 * svarinfoen i `hentAlleSaker` er nye i v2 (master–detaljsiden etter innmeldinger-v3-
 * mockupen). Tyngdepunktet er reglene panelet lener seg på:
 *
 *  1. «Ubesvart» regnes av FØRSTE ikke-interne svar — et internt notat er ikke et svar
 *     kunden har fått, og skal ikke få saken til å se besvart ut.
 *  2. Statusendringer føres som interne trådinnlegg av serveren, og `bleLost` er sann kun
 *     ved OVERGANGEN til løst — det er den som utløser e-posten til melderen.
 *  3. Et svar til melderen på en ny sak flytter den til under arbeid.
 *
 * Alt kjører gjennom `withoutRls("plattformpanel")` slik `plattformRute` gjør det —
 * tabellene står i UNNTATT (DriftIQs egen sakskø, se rls/tables.ts).
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import {
  hentAlleSaker,
  hentSak,
  meldFeil,
  settBacklog,
  settStatus,
  svarPaSak,
} from "../src/lib/feilmelding";

let eierPool: Pool;
let orgId: string;
let brukerId: string;
const ryddSaker: string[] = [];

const melder = () => ({ id: brukerId, name: "Elin Vik", email: "elin@driftiq.test" });

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  orgId = randomUUID();
  brukerId = randomUUID();
  await eierPool.query(
    "INSERT INTO organizations (id, name, slug, active) VALUES ($1, $2, $3, true)",
    [orgId, "Testlaget for innmeldinger", `test-fm-${orgId.slice(0, 8)}`],
  );
  await eierPool.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, 'member', true, true, now(), now())`,
    [brukerId, "Elin Vik", `${brukerId}@driftiq.test`],
  );
});

afterAll(async () => {
  await eierPool.query("DELETE FROM users WHERE id = $1", [brukerId]);
  await eierPool.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  // feedback_messages ryddes av CASCADE når saken slettes.
  for (const id of ryddSaker.splice(0)) {
    await eierPool.query("DELETE FROM feedback_reports WHERE id = $1", [id]);
  }
});

async function nySak(beskrivelse = "Knappen gjør ingenting når jeg trykker på den") {
  return withoutRls("plattformpanel", async (db) => {
    const sak = await meldFeil(
      db,
      orgId,
      melder(),
      {
        kind: "bug",
        description: beskrivelse,
        appVersion: "0.1.0",
        url: "/avvik/nytt",
        screen: "412 × 915",
      },
      "Mozilla/5.0 (Linux; Android 15) Chrome/141.0",
    );
    ryddSaker.push(sak.id);
    return sak;
  });
}

describe("teknisk kontekst", () => {
  it("side og vindusstørrelse lagres med saken", async () => {
    const sak = await nySak();
    expect(sak.url).toBe("/avvik/nytt");
    expect(sak.screen).toBe("412 × 915");
    expect(sak.userAgent).toContain("Chrome/141");
  });
});

describe("svarinfo i hentAlleSaker", () => {
  it("interne notater teller ikke som svar — første ikke-interne gjør det", async () => {
    const sak = await nySak();

    await withoutRls("plattformpanel", (db) =>
      svarPaSak(db, sak.id, "Kristoffer", { body: "Ligner FM-0031", internal: true }),
    );
    let rad = (await withoutRls("plattformpanel", (db) => hentAlleSaker(db))).find(
      (s) => s.id === sak.id,
    );
    expect(rad!.forsteSvar).toBeNull();

    await withoutRls("plattformpanel", (db) =>
      svarPaSak(db, sak.id, "Kristoffer", { body: "Takk, jeg ser på det!", internal: false }),
    );
    rad = (await withoutRls("plattformpanel", (db) => hentAlleSaker(db))).find(
      (s) => s.id === sak.id,
    );
    expect(rad!.forsteSvar).not.toBeNull();
  });

  it("svar til melderen flytter en ny sak til under arbeid — internt notat gjør det ikke", async () => {
    const sak = await nySak();

    await withoutRls("plattformpanel", (db) =>
      svarPaSak(db, sak.id, "Kristoffer", { body: "Bare til meg selv", internal: true }),
    );
    let hentet = await withoutRls("plattformpanel", (db) => hentSak(db, sak.id));
    expect(hentet.status).toBe("ny");

    await withoutRls("plattformpanel", (db) =>
      svarPaSak(db, sak.id, "Kristoffer", { body: "Jeg ser på det", internal: false }),
    );
    hentet = await withoutRls("plattformpanel", (db) => hentSak(db, sak.id));
    expect(hentet.status).toBe("under_arbeid");
  });
});

describe("statusendringer", () => {
  it("føres som internt trådinnlegg — uendret status logges ikke", async () => {
    const sak = await nySak();
    await withoutRls("plattformpanel", async (db) => {
      await settStatus(db, sak.id, "under_arbeid", "Kristoffer");
      await settStatus(db, sak.id, "under_arbeid", "Kristoffer");
    });
    const hentet = await withoutRls("plattformpanel", (db) => hentSak(db, sak.id));
    const logglinjer = hentet.meldinger.filter((m) => m.body === "Status satt til Under arbeid");
    expect(logglinjer).toHaveLength(1);
    expect(logglinjer[0]!.internal).toBe(true);
    expect(logglinjer[0]!.authorName).toBe("Kristoffer");
  });

  it("bleLost er sann kun ved overgangen til løst", async () => {
    const sak = await nySak();
    const forste = await withoutRls("plattformpanel", (db) =>
      settStatus(db, sak.id, "lost", "Kristoffer"),
    );
    expect(forste.bleLost).toBe(true);
    expect(forste.sak.resolvedAt).not.toBeNull();
    expect(forste.sak.resolvedBy).toBe("Kristoffer");

    const andre = await withoutRls("plattformpanel", (db) =>
      settStatus(db, sak.id, "lost", "Kristoffer"),
    );
    expect(andre.bleLost).toBe(false);

    // Gjenåpning nullstiller løst-feltene — ellers ser en gjenåpnet sak løst ut i rapporter.
    const tredje = await withoutRls("plattformpanel", (db) =>
      settStatus(db, sak.id, "ny", "Kristoffer"),
    );
    expect(tredje.sak.resolvedAt).toBeNull();
    expect(tredje.bleLost).toBe(false);
  });
});

describe("backlog", () => {
  it("bryteren settes og fjernes", async () => {
    const sak = await nySak();
    const paa = await withoutRls("plattformpanel", (db) => settBacklog(db, sak.id, true));
    expect(paa.inBacklog).toBe(true);
    const av = await withoutRls("plattformpanel", (db) => settBacklog(db, sak.id, false));
    expect(av.inBacklog).toBe(false);
  });
});
