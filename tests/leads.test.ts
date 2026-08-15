/**
 * Leads — ikke en v1-port: aktivitetsloggen og neste steg-oppfølgingen er nye i v2
 * (master–detaljsiden etter leads-v3-mockupen). Tyngdepunktet er at loggen skrives av
 * SERVEREN ved hver flytting — historikken skal aldri avhenge av at noen husket å notere —
 * og at «konvertert» forblir en lås, ikke en status man kan velge eller forlate.
 *
 * Alt kjører gjennom `withoutRls("plattformpanel")` slik `plattformRute` gjør det:
 * leads er en plattformtabell uten org_id (se UNNTATT i rls/tables.ts).
 * Ingen tester bruker org.nr — det ville truffet Enhetsregisteret over nettet.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { z } from "zod";
import { lukkPooler, withoutRls } from "../src/db/client";
import type { Aktor } from "../src/lib/aktor";
import type { ApiFeil } from "../src/lib/api";
import {
  hentLeadAktiviteter,
  hentLeads,
  konverterLead,
  leadInn,
  leggTilLeadNotat,
  oppdaterLead,
  opprettLeadManuelt,
  registrerLead,
  slettLead,
} from "../src/lib/leads";

let eierPool: Pool;
const ryddLeads: string[] = [];
const ryddOrg: string[] = [];

const aktor: Aktor = { navn: "Test Plattformadmin", brukerId: null };

beforeAll(() => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
});

afterAll(async () => {
  await eierPool.end();
  await lukkPooler();
});

afterEach(async () => {
  // lead_activities ryddes av CASCADE når leaden slettes; leads før organizations
  // fordi converted_org_id peker dit (SET NULL, men ryddig uansett).
  for (const id of ryddLeads.splice(0)) {
    await eierPool.query("DELETE FROM leads WHERE id = $1", [id]);
  }
  for (const id of ryddOrg.splice(0)) {
    await eierPool.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

/** Ny lead rett fra landingsskjemaet, uten org.nr (ingen nettverkskall). */
async function nyLead(felter: Partial<z.infer<typeof leadInn>> = {}) {
  return withoutRls("plattformpanel", async (db) => {
    const resultat = await registrerLead(
      db,
      leadInn.parse({ name: "Marit Skjold", email: "marit@example.test", ...felter }),
    );
    if (!resultat.lagret) throw new Error("uventet: honningkrukka slo til");
    ryddLeads.push(resultat.lead.id);
    return resultat.lead;
  });
}

describe("registrering", () => {
  it("logger «Lead opprettet fra landingssiden» på nye leads", async () => {
    const lead = await nyLead();
    const logg = await withoutRls("plattformpanel", (db) => hentLeadAktiviteter(db, lead.id));
    expect(logg).toHaveLength(1);
    expect(logg[0]!.text).toBe("Lead opprettet fra landingssiden");
    // Ingen aktør — det er systemet som skriver, ikke en innlogget.
    expect(logg[0]!.actorName).toBeNull();
  });

  it("utfylt honningkrukke lagrer ingenting, men later som alt gikk bra", async () => {
    const resultat = await withoutRls("plattformpanel", (db) =>
      registrerLead(db, leadInn.parse({ name: "Robot", email: "bot@example.test", felle: "x" })),
    );
    expect(resultat.lagret).toBe(false);
  });

  it("manuell registrering får aktør i loggen", async () => {
    const lead = await withoutRls("plattformpanel", async (db) => {
      const rad = await opprettLeadManuelt(
        db,
        { name: "Bjørn Tvedt", email: "bjorn@example.test" },
        aktor,
      );
      ryddLeads.push(rad.id);
      return rad;
    });
    const logg = await withoutRls("plattformpanel", (db) => hentLeadAktiviteter(db, lead.id));
    expect(logg[0]!.text).toBe("Lead lagt inn manuelt");
    expect(logg[0]!.actorName).toBe("Test Plattformadmin");
  });
});

describe("statusflyt", () => {
  it("flytting logges, og avslag tar med begrunnelsen som notat", async () => {
    const lead = await nyLead();
    await withoutRls("plattformpanel", async (db) => {
      await oppdaterLead(db, lead.id, { status: "kontaktet" }, aktor);
      await oppdaterLead(db, lead.id, { status: "avslatt", notat: "Bundet i annen avtale" }, aktor);
    });
    const logg = await withoutRls("plattformpanel", (db) => hentLeadAktiviteter(db, lead.id));
    const tekster = logg.map((r) => r.text);
    expect(tekster).toContain("Flyttet til Kontaktet");
    expect(tekster).toContain("Avslått");
    expect(logg.find((r) => r.text === "Avslått")!.note).toBe("Bundet i annen avtale");
  });

  it("gjenåpning fra avslått logges som gjenåpning, ikke flytting", async () => {
    const lead = await nyLead();
    await withoutRls("plattformpanel", async (db) => {
      await oppdaterLead(db, lead.id, { status: "avslatt" }, aktor);
      await oppdaterLead(db, lead.id, { status: "ny" }, aktor);
    });
    const logg = await withoutRls("plattformpanel", (db) => hentLeadAktiviteter(db, lead.id));
    expect(logg.map((r) => r.text)).toContain("Gjenåpnet som Ny");
  });

  it("statusendring nullstiller avtalt neste steg", async () => {
    const lead = await nyLead();
    const etter = await withoutRls("plattformpanel", async (db) => {
      await oppdaterLead(
        db,
        lead.id,
        { neste: { tekst: "Ringe tilbake", dato: "2030-01-15" } },
        aktor,
      );
      return oppdaterLead(db, lead.id, { status: "kontaktet" }, aktor);
    });
    expect(etter.nextAction).toBeNull();
    expect(etter.nextDate).toBeNull();
  });
});

describe("neste steg", () => {
  it("settes med logglinje, fjernes uten", async () => {
    const lead = await nyLead();
    const medNeste = await withoutRls("plattformpanel", (db) =>
      oppdaterLead(db, lead.id, { neste: { tekst: "Demo for styret", dato: "2030-02-01" } }, aktor),
    );
    expect(medNeste.nextAction).toBe("Demo for styret");
    expect(medNeste.nextDate).toBe("2030-02-01");

    const uten = await withoutRls("plattformpanel", (db) =>
      oppdaterLead(db, lead.id, { neste: null }, aktor),
    );
    expect(uten.nextAction).toBeNull();

    const logg = await withoutRls("plattformpanel", (db) => hentLeadAktiviteter(db, lead.id));
    // Én linje for settingen — fjerningen er ikke en hendelse («Marker som gjort»
    // skriver sin egen loggrad fra panelet).
    expect(logg.filter((r) => r.text.startsWith("Neste steg satt")).length).toBe(1);
    expect(logg.map((r) => r.text)).toContain("Neste steg satt: Demo for styret");
  });
});

describe("notater og sletting", () => {
  it("notat legges øverst i loggen med aktørnavn", async () => {
    const lead = await nyLead();
    const logg = await withoutRls("plattformpanel", (db) =>
      leggTilLeadNotat(db, lead.id, "Ringt, la igjen beskjed", aktor),
    );
    expect(logg[0]!.text).toBe("Ringt, la igjen beskjed");
    expect(logg[0]!.actorName).toBe("Test Plattformadmin");
  });

  it("sletting av leaden tar loggen med seg (CASCADE)", async () => {
    const lead = await nyLead();
    await withoutRls("plattformpanel", (db) => slettLead(db, lead.id));
    const rester = await eierPool.query("SELECT id FROM lead_activities WHERE lead_id = $1", [
      lead.id,
    ]);
    expect(rester.rowCount).toBe(0);
  });
});

describe("konvertering", () => {
  it("oppretter kunden, låser statusen og logger med kundenavnet", async () => {
    const lead = await nyLead({ company: "Fana Sameie Test" });
    const org = await withoutRls("plattformpanel", (db) => konverterLead(db, lead.id, aktor));
    ryddOrg.push(org.id);
    expect(org.name).toBe("Fana Sameie Test");

    const [rad] = (await withoutRls("plattformpanel", (db) => hentLeads(db))).filter(
      (l) => l.id === lead.id,
    );
    expect(rad!.status).toBe("konvertert");
    expect(rad!.convertedOrgId).toBe(org.id);

    const logg = await withoutRls("plattformpanel", (db) => hentLeadAktiviteter(db, lead.id));
    const linje = logg.find((r) => r.text === "Opprettet som kunde");
    expect(linje?.note).toBe("Fana Sameie Test");

    // Låst: en konvertert lead kan ikke flyttes tilbake i løpet.
    const feil = await withoutRls("plattformpanel", (db) =>
      oppdaterLead(db, lead.id, { status: "ny" }, aktor).catch((e: ApiFeil) => e),
    );
    expect((feil as ApiFeil).status).toBe(400);
  });
});
