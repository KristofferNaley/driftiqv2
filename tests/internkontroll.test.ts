/**
 * Internkontroll — kravene i internkontrollforskriften § 5 andre ledd.
 *
 * Modulen er dokumentasjon før den er funksjonalitet: det som testes her er at
 * dokumentasjonen ikke kan bli utroverdig. En låst vernerunde må forbli låst, en signatur
 * må være personlig, og punktene på en gjennomført runde må vise hva som faktisk ble
 * sjekket — ikke hva malen sier i dag.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg, withoutRls } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { opprettAvvik } from "../src/lib/avvik";
import {
  ANSVARSOMRADER,
  endrePunkt,
  endreSjekklistepunkt,
  fjernSignatur,
  fullforRunde,
  hentAnsvar,
  hentFarer,
  hentRunde,
  hentRunder,
  hentSjekkliste,
  leggTilDeltaker,
  leggTilPunkt as leggTilRundepunkt,
  leggTilSjekklistepunkt,
  opprettEvaluering,
  opprettFare,
  opprettMal,
  opprettRunde,
  opprettSjekkliste,
  opprettTiltak,
  risiko,
  risikoniva,
  seedFarer,
  settAnsvar,
  signerMal,
  slettPunkt,
  slettRunde,
  slettSjekkliste,
  slettSjekklistepunkt,
  status,
} from "../src/lib/internkontroll";
import { leggTilKategori, leggTilPunkt, opprettMal as opprettHmsMal } from "../src/lib/maler";
import { anonymAktor } from "../src/lib/aktor";

/** Aktøren i testene: navn uten konto. Id-koblingen testes i aktivitet.test.ts. */
const KARI = anonymAktor("Kari");

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
    await eier.query("DELETE FROM deviation_logs WHERE deviation_id IN (SELECT id FROM deviations WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM deviations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM safety_round_items WHERE round_id IN (SELECT id FROM safety_rounds WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM safety_round_participants WHERE round_id IN (SELECT id FROM safety_rounds WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM safety_rounds WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM safety_round_checklist_items WHERE checklist_id IN (SELECT id FROM safety_round_checklists WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM safety_round_checklists WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM hazard_actions WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM hazards WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM hms_goal_approvals WHERE goal_id IN (SELECT id FROM hms_goals WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM hms_sub_goals WHERE goal_id IN (SELECT id FROM hms_goals WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM hms_goals WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM hms_responsibilities WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM hms_evaluations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddMal.splice(0)) await eier.query("DELETE FROM hms_templates WHERE id = $1", [id]);
});

async function oppsett() {
  const orgId = `ik-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId, "HMS-laget", orgId,
  ]);
  ryddOrg.push(orgId);
  return orgId;
}

async function nyBruker(orgId: string, navn: string) {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,$2,$3,'member',true,true,now(),now())`,
    [id, navn, `${id}@driftiq.test`],
  );
  await eier.query(
    "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'redigering')",
    [randomUUID(), id, orgId],
  );
  return id;
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

const iAar = new Date().getFullYear();

describe("HMS-mål (§ 5 pkt. 4)", () => {
  it("tillater bare ett mål per år", async () => {
    const org = await oppsett();
    await i(org, (db) => opprettMal(db, org, { year: iAar, goalText: "Null skader", approved: false }));
    const feil = await feilFra(() =>
      i(org, (db) => opprettMal(db, org, { year: iAar, goalText: "Noe annet", approved: false })),
    );
    expect(feil.message).toMatch(new RegExp(`allerede et HMS-mål for ${iAar}`));
  });

  it("lar samme år brukes i en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    await i(a, (db) => opprettMal(db, a, { year: iAar, goalText: "Vårt", approved: false }));
    const iB = await i(b, (db) => opprettMal(db, b, { year: iAar, goalText: "Deres", approved: false }));
    expect(iB.year).toBe(iAar);
  });
});

describe("signatur", () => {
  it("er personlig og kan ikke gjentas", async () => {
    // En dobbeltsignatur ville sett ut som to styremedlemmer i dokumentasjonen.
    const org = await oppsett();
    const bruker = await nyBruker(org, "Kari");
    const mal = await i(org, (db) => opprettMal(db, org, { year: iAar, goalText: "Mål", approved: false }));

    await i(org, (db) => signerMal(db, org, mal.id, bruker));
    const feil = await feilFra(() => i(org, (db) => signerMal(db, org, mal.id, bruker)));
    expect(feil.message).toMatch(/allerede signert/i);
  });

  it("teller én signatur per styremedlem", async () => {
    const org = await oppsett();
    const a = await nyBruker(org, "Kari");
    const b = await nyBruker(org, "Ola");
    const mal = await i(org, (db) => opprettMal(db, org, { year: iAar, goalText: "Mål", approved: false }));

    await i(org, (db) => signerMal(db, org, mal.id, a));
    await i(org, (db) => signerMal(db, org, mal.id, b));

    const { signaturer } = await i(org, (db) =>
      import("../src/lib/internkontroll").then((m) => m.hentEttMal(db, org, mal.id)),
    );
    expect(signaturer.map((s) => s.navn).sort()).toEqual(["Kari", "Ola"]);
  });

  it("kan trekkes tilbake av den som signerte", async () => {
    const org = await oppsett();
    const bruker = await nyBruker(org, "Kari");
    const mal = await i(org, (db) => opprettMal(db, org, { year: iAar, goalText: "Mål", approved: false }));
    await i(org, (db) => signerMal(db, org, mal.id, bruker));
    await i(org, (db) => fjernSignatur(db, org, mal.id, bruker));

    const feil = await feilFra(() => i(org, (db) => fjernSignatur(db, org, mal.id, bruker)));
    expect(feil.status).toBe(404);
  });
});

describe("ansvarsfordeling (§ 5 pkt. 5)", () => {
  it("returnerer alle områdene, også de tomme", async () => {
    // Et manglende område er nettopp det kunden skal SE at mangler.
    const org = await oppsett();
    const ansvar = await i(org, (db) => hentAnsvar(db, org));
    expect(ansvar.map((a) => a.area)).toEqual([...ANSVARSOMRADER]);
    expect(ansvar.every((a) => a.personName === null)).toBe(true);
  });

  it("oppdaterer i stedet for å duplisere", async () => {
    const org = await oppsett();
    await i(org, (db) => settAnsvar(db, org, { area: "brannvern", personName: "Ola" }));
    await i(org, (db) => settAnsvar(db, org, { area: "brannvern", personName: "Kari" }));

    const ansvar = await i(org, (db) => hentAnsvar(db, org));
    expect(ansvar.filter((a) => a.area === "brannvern")).toHaveLength(1);
    expect(ansvar.find((a) => a.area === "brannvern")?.personName).toBe("Kari");
  });
});

describe("risikovurdering (§ 5 pkt. 6)", () => {
  it("regner risiko som sannsynlighet × konsekvens", () => {
    expect(risiko({ probability: 2, consequence: 3 })).toBe(6);
    // NULL = ikke vurdert — ikke 0, ikke et forvalg.
    expect(risiko({ probability: null, consequence: 3 })).toBeNull();
    // 1–3-skalaen gir produktene 1, 2, 3, 4, 6 og 9.
    expect(risikoniva(2)).toBe("lav");
    expect(risikoniva(4)).toBe("middels");
    expect(risikoniva(6)).toBe("hoy");
  });

  it("sorterer høyest risiko først", async () => {
    // Lista skal kunne leses ovenfra og ned.
    const org = await oppsett();
    await i(org, (db) => opprettFare(db, org, { title: "Lav", probability: 1, consequence: 2, status: "open" }));
    await i(org, (db) => opprettFare(db, org, { title: "Høy", probability: 3, consequence: 3, status: "open" }));

    const farer = await i(org, (db) => hentFarer(db, org));
    expect(farer.map((f) => f.title)).toEqual(["Høy", "Lav"]);
    expect(farer[0]!.niva).toBe("hoy");
  });

  it("henter tiltakene sammen med faren", async () => {
    const org = await oppsett();
    const fare = await i(org, (db) => opprettFare(db, org, { title: "Glatt", probability: 3, consequence: 3, status: "open" }));
    await i(org, (db) => opprettTiltak(db, org, { hazardId: fare.id, title: "Strø", status: "not_started" }));

    const farer = await i(org, (db) => hentFarer(db, org));
    expect(farer[0]!.tiltak.map((t) => t.title)).toEqual(["Strø"]);
  });

  it("avviser tiltak på en fare i en annen org", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const fareB = await i(b, (db) => opprettFare(db, b, { title: "Deres", probability: 1, consequence: 1, status: "open" }));
    const feil = await feilFra(() =>
      i(a, (db) => opprettTiltak(db, a, { hazardId: fareB.id, title: "Tyv", status: "not_started" })),
    );
    expect(feil.status).toBe(404);
  });
});

describe("vernerunde", () => {
  async function malMedPunkter() {
    const mal = await p((db) =>
      opprettHmsMal(db, { templateType: "vernerunde", name: `Test ${randomUUID().slice(0, 8)}`, isDefault: false, active: true }),
    );
    ryddMal.push(mal.id);
    const kat = await p((db) => leggTilKategori(db, mal.id, { key: "brann", label: "Brannvern", order: 0 }));
    await p((db) => leggTilPunkt(db, kat.id, { text: "Sjekk slokkeapparat", order: 0 }));
    return mal;
  }

  it("kopierer punktene fra malen inn i runden", async () => {
    const org = await oppsett();
    const mal = await malMedPunkter();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår 2026", templateId: mal.id }));

    expect(runde.punkter.map((p) => p.text)).toEqual(["Sjekk slokkeapparat"]);
    expect(runde.punkter[0]!.section).toBe("Brannvern");
  });

  it("endrer ikke en gjennomført runde når malen endres etterpå", async () => {
    // Runden dokumenterer hva som ble sjekket den dagen, ikke hva malen sier i dag.
    const org = await oppsett();
    const mal = await malMedPunkter();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår", templateId: mal.id }));

    // Skopet til testens EGEN mal. Testene deler base med appen, og et UPDATE uten WHERE
    // omskrev punktteksten i alle standardmalene i drift (påvist 14.08.2026).
    await eier.query(
      "UPDATE hms_template_items SET text = 'Helt annet punkt' WHERE category_id IN (SELECT id FROM hms_template_categories WHERE template_id = $1)",
      [mal.id],
    );

    const etter = await i(org, (db) => hentRunde(db, org, runde.id));
    expect(etter.punkter[0]!.text).toBe("Sjekk slokkeapparat");
  });

  it("låser runden når den fullføres", async () => {
    const org = await oppsett();
    const mal = await malMedPunkter();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår", templateId: mal.id }));
    await i(org, (db) => fullforRunde(db, org, runde.id));

    const feil = await feilFra(() =>
      i(org, (db) => endrePunkt(db, org, runde.id, runde.punkter[0]!.id, { checked: true })),
    );
    expect(feil.message).toMatch(/fullført og låst/i);
  });

  it("hindrer at deltakere legges til eller runden slettes etter fullføring", async () => {
    const org = await oppsett();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår" }));
    await i(org, (db) => fullforRunde(db, org, runde.id));

    expect((await feilFra(() => i(org, (db) => leggTilDeltaker(db, org, runde.id, { name: "Ola" })))).status).toBe(400);
    expect((await feilFra(() => i(org, (db) => slettRunde(db, org, runde.id)))).status).toBe(400);
  });

  it("kan ikke fullføres to ganger", async () => {
    const org = await oppsett();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår" }));
    await i(org, (db) => fullforRunde(db, org, runde.id));
    expect((await feilFra(() => i(org, (db) => fullforRunde(db, org, runde.id)))).status).toBe(400);
  });

  it("lister avvikene som ble meldt under runden", async () => {
    const org = await oppsett();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår" }));
    await i(org, (db) => opprettAvvik(db, org, KARI, { title: "Skadet rekkverk", roundId: runde.id }));

    const etter = await i(org, (db) => hentRunde(db, org, runde.id));
    expect(etter.avvik.map((a) => a.title)).toEqual(["Skadet rekkverk"]);
  });

  it("kopierer punktene fra FORRIGE runde når ingen mal er valgt", async () => {
    // Slik blir lagets tilpasninger varige: malen starter første runde, deretter eier
    // laget sin egen liste — inkludert punkter de selv har lagt til.
    const org = await oppsett();
    const mal = await malMedPunkter();
    const forste = await i(org, (db) => opprettRunde(db, org, { title: "Vår", templateId: mal.id }));
    await i(org, (db) => leggTilRundepunkt(db, org, forste.id, { text: "Sjekk lekeplassen", section: "Uteareal" }));
    // Svar og kommentarer skal IKKE kopieres — bare hva som sjekkes.
    await i(org, (db) => endrePunkt(db, org, forste.id, forste.punkter[0]!.id, { status: "avvik", notes: "Rust" }));

    const neste = await i(org, (db) => opprettRunde(db, org, { title: "Høst" }));
    expect(neste.punkter.map((p) => p.text).sort()).toEqual(["Sjekk lekeplassen", "Sjekk slokkeapparat"]);
    expect(neste.punkter.every((p) => p.status === null && p.notes === null)).toBe(true);
  });

  it("holder checked i takt med trestatusen", async () => {
    const org = await oppsett();
    const mal = await malMedPunkter();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår", templateId: mal.id }));
    const punktId = runde.punkter[0]!.id;

    expect((await i(org, (db) => endrePunkt(db, org, runde.id, punktId, { status: "ok" }))).checked).toBe(true);
    expect((await i(org, (db) => endrePunkt(db, org, runde.id, punktId, { status: "avvik" }))).checked).toBe(false);
    expect((await i(org, (db) => endrePunkt(db, org, runde.id, punktId, { status: null }))).status).toBeNull();
  });

  it("nekter å legge til eller fjerne punkter på en låst runde", async () => {
    const org = await oppsett();
    const mal = await malMedPunkter();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Vår", templateId: mal.id }));
    await i(org, (db) => fullforRunde(db, org, runde.id));

    expect((await feilFra(() => i(org, (db) => leggTilRundepunkt(db, org, runde.id, { text: "Nytt" })))).status).toBe(400);
    expect((await feilFra(() => i(org, (db) => slettPunkt(db, org, runde.id, runde.punkter[0]!.id)))).status).toBe(400);
  });

  it("seeder lagets farer fra risikovurderingsmalen — idempotent", async () => {
    const org = await oppsett();
    const mal = await p((db) =>
      opprettHmsMal(db, { templateType: "risikovurdering", name: `Risiko ${randomUUID().slice(0, 8)}`, isDefault: false, active: true }),
    );
    ryddMal.push(mal.id);
    const kat = await p((db) => leggTilKategori(db, mal.id, { key: "brann", label: "Brannvern", order: 0 }));
    await p((db) => leggTilPunkt(db, kat.id, { text: "Brann i søppelrom", order: 0 }));
    await p((db) => leggTilPunkt(db, kat.id, { text: "Blokkert rømningsvei", order: 1 }));

    const forste = await i(org, (db) => seedFarer(db, org, mal.id));
    expect(forste).toEqual({ opprettet: 2, hoppetOver: 0 });

    const farer = await i(org, (db) => hentFarer(db, org));
    expect(farer.map((f) => f.category)).toEqual(["Brannvern", "Brannvern"]);
    // Uvurdert, ikke et forvalg: 2/2 så ut som en gjennomført vurdering ingen hadde gjort.
    expect(farer.every((f) => f.probability === null && f.consequence === null && f.niva === null)).toBe(true);

    const igjen = await i(org, (db) => seedFarer(db, org, mal.id));
    expect(igjen).toEqual({ opprettet: 0, hoppetOver: 2 });
  });
});

describe("sjekklister (rundetyper)", () => {
  async function malMedToSeksjoner() {
    const mal = await p((db) =>
      opprettHmsMal(db, { templateType: "vernerunde", name: `Std ${randomUUID().slice(0, 8)}`, isDefault: false, active: true }),
    );
    ryddMal.push(mal.id);
    const inne = await p((db) => leggTilKategori(db, mal.id, { key: "oppgang", label: "Oppganger", order: 0 }));
    const ute = await p((db) => leggTilKategori(db, mal.id, { key: "ute", label: "Uteområde", order: 1 }));
    await p((db) => leggTilPunkt(db, inne.id, { text: "Rømningsveier frie", order: 0 }));
    await p((db) => leggTilPunkt(db, inne.id, { text: "Nødlys lyser", order: 1 }));
    await p((db) => leggTilPunkt(db, ute.id, { text: "Dekke uten snublefeller", order: 0 }));
    return mal;
  }

  it("kopierer standardmalen inn som lagets egen liste, i mal-rekkefølge", async () => {
    const org = await oppsett();
    const mal = await malMedToSeksjoner();
    const liste = await i(org, (db) => opprettSjekkliste(db, org, { name: "Vernerunde inne", templateId: mal.id }));

    expect(liste.punkter.map((x) => x.text)).toEqual([
      "Rømningsveier frie", "Nødlys lyser", "Dekke uten snublefeller",
    ]);
    expect(liste.punkter.map((x) => x.section)).toEqual(["Oppganger", "Oppganger", "Uteområde"]);

    // Laget eier kopien: punkter som ikke gjelder dem, slettes uten at malen røres.
    await i(org, (db) => slettSjekklistepunkt(db, org, liste.id, liste.punkter[2]!.id));
    const etter = await i(org, (db) => hentSjekkliste(db, org, liste.id));
    expect(etter.punkter).toHaveLength(2);
    const malPunkter = await eier.query("SELECT count(*)::int AS n FROM hms_template_items i JOIN hms_template_categories k ON k.id = i.category_id WHERE k.template_id = $1", [mal.id]);
    expect(malPunkter.rows[0].n).toBe(3);
  });

  it("oppretter runden med punktene fra sjekklista og deltakerne fra planleggingen", async () => {
    // Befaringen planlegges med folk og dato FØR punktene gås gjennom.
    const org = await oppsett();
    const mal = await malMedToSeksjoner();
    const liste = await i(org, (db) => opprettSjekkliste(db, org, { name: "Inne", templateId: mal.id }));

    const runde = await i(org, (db) =>
      opprettRunde(db, org, {
        title: "Inne — høst",
        checklistId: liste.id,
        deltakere: [{ name: "Kari", role: "styreleder" }, { name: "Tore", role: null }],
      }),
    );

    expect(runde.punkter.map((x) => x.text)).toEqual([
      "Rømningsveier frie", "Nødlys lyser", "Dekke uten snublefeller",
    ]);
    expect(runde.deltakere.map((d) => d.name)).toEqual(["Kari", "Tore"]);
    expect(runde.checklistId).toBe(liste.id);
  });

  it("lar sjekklista endres uten at en opprettet runde påvirkes", async () => {
    const org = await oppsett();
    const liste = await i(org, (db) => opprettSjekkliste(db, org, { name: "Ute" }));
    const punkt = await i(org, (db) => leggTilSjekklistepunkt(db, org, liste.id, { text: "Lekeapparater", section: "Uteområde" }));
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Ute — vår", checklistId: liste.id }));

    await i(org, (db) => leggTilSjekklistepunkt(db, org, liste.id, { text: "Utebelysning", section: "Uteområde" }));
    // Omformulering er trygt — runden har en KOPI av punktet.
    await i(org, (db) => endreSjekklistepunkt(db, org, liste.id, punkt.id, { text: "Lekeapparater og fallunderlag" }));

    const etter = await i(org, (db) => hentRunde(db, org, runde.id));
    expect(etter.punkter.map((x) => x.text)).toEqual(["Lekeapparater"]);

    // Neste runde fra samme liste får både omformuleringen og det nye punktet.
    const neste = await i(org, (db) => opprettRunde(db, org, { title: "Ute — høst", checklistId: liste.id }));
    expect(neste.punkter.map((x) => x.text)).toEqual(["Lekeapparater og fallunderlag", "Utebelysning"]);
  });

  it("lar gjennomførte runder stå når sjekklista slettes", async () => {
    const org = await oppsett();
    const liste = await i(org, (db) => opprettSjekkliste(db, org, { name: "Garasje" }));
    await i(org, (db) => leggTilSjekklistepunkt(db, org, liste.id, { text: "Port og ladepunkt" }));
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Garasje — vår", checklistId: liste.id }));
    await i(org, (db) => fullforRunde(db, org, runde.id));

    await i(org, (db) => slettSjekkliste(db, org, liste.id));

    const etter = await i(org, (db) => hentRunde(db, org, runde.id));
    expect(etter.punkter.map((x) => x.text)).toEqual(["Port og ladepunkt"]);
    expect(etter.checklistId).toBeNull();
    expect((await i(org, (db) => hentRunder(db, org)))[0]!.checklistName).toBeNull();
  });

  it("holder en annen orgs sjekkliste utenfor rekkevidde", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const liste = await i(a, (db) => opprettSjekkliste(db, a, { name: "Vår liste" }));

    expect((await feilFra(() => i(b, (db) => hentSjekkliste(db, b, liste.id)))).status).toBe(404);
    // En runde i b kan ikke opprettes fra a sin liste — 404, ikke en tom runde.
    expect(
      (await feilFra(() => i(b, (db) => opprettRunde(db, b, { title: "Snik", checklistId: liste.id })))).status,
    ).toBe(404);
  });
});

describe("årlig evaluering (§ 5 pkt. 8)", () => {
  it("tillater bare én per år", async () => {
    const org = await oppsett();
    await i(org, (db) => opprettEvaluering(db, org, { year: iAar, conclusion: "Virker" }));
    const feil = await feilFra(() => i(org, (db) => opprettEvaluering(db, org, { year: iAar })));
    expect(feil.message).toMatch(/allerede en evaluering/i);
  });
});

describe("status", () => {
  it("viser hva som mangler", async () => {
    const org = await oppsett();
    expect(await i(org, (db) => status(db, org))).toMatchObject({
      maalSatt: false,
      ansvarFordelt: false,
      risikoKartlagt: false,
      vernerundeGjennomfort: false,
      evaluert: false,
    });
  });

  it("krever at ALLE ansvarsområder er fordelt", async () => {
    const org = await oppsett();
    await i(org, (db) => settAnsvar(db, org, { area: "brannvern", personName: "Ola" }));
    expect((await i(org, (db) => status(db, org))).ansvarFordelt, "Ett av tre holdt").toBe(false);

    for (const area of ANSVARSOMRADER) {
      await i(org, (db) => settAnsvar(db, org, { area, personName: "Ola" }));
    }
    expect((await i(org, (db) => status(db, org))).ansvarFordelt).toBe(true);
  });

  it("teller bare FULLFØRTE vernerunder", async () => {
    // En planlagt runde dokumenterer ingenting.
    const org = await oppsett();
    const runde = await i(org, (db) => opprettRunde(db, org, { title: "Planlagt" }));
    expect((await i(org, (db) => status(db, org))).vernerundeGjennomfort).toBe(false);

    await i(org, (db) => fullforRunde(db, org, runde.id));
    expect((await i(org, (db) => status(db, org))).vernerundeGjennomfort).toBe(true);
  });
});
