/**
 * Oppslagstavla — infoskjermer i oppgangen. Ingen v1-forgjenger; bygget fra mockupen
 * (docs/oppslagstavle.md).
 *
 * Tyngdepunktet er skjermens anonyme inngang: koblingen (kode → token, én gang), at tokenet
 * bare gir ett borettslags oppslag, og at en fjernet skjerm mister tilgangen med en gang.
 * Det er den eneste veien inn i modulen uten sesjon, og den går delvis utenom RLS.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import { anonymAktor } from "../src/lib/aktor";
import {
  endreOppslag,
  filForSkjerm,
  flyttKontakt,
  hentKontakter,
  kontaktbildeForSkjerm,
  endreKontakt,
  oppslagInn,
  opprettKontakt,
  slettKontakt,
  hentHendelser,
  hentSkjermer,
  innholdForSkjerm,
  kobleSkjerm,
  opprettHendelse,
  opprettOppslag,
  sjekkKobling,
  slettSkjerm,

  startKobling,
} from "../src/lib/oppslagstavle";
import {
  normaliserKode,
  oppslagStatus,
  osloIDag,
  skjermpalett,
} from "../src/lib/oppslagstavleregler";

const KARI = anonymAktor("Kari");

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddKoder: string[] = [];
const ryddBrukere: string[] = [];

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
  for (const kode of ryddKoder.splice(0)) {
    await eier.query("DELETE FROM board_pairings WHERE code = $1", [kode]);
  }
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM board_posts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_pairings WHERE screen_id IN (SELECT id FROM board_screens WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM board_screens WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_settings WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_contacts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_blocks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM board_placements WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  // Etter orgene: kontaktene (og medlemskapene) som peker på brukerne er borte da.
  for (const id of ryddBrukere.splice(0)) await eier.query("DELETE FROM users WHERE id = $1", [id]);
});

async function nyOrg(navn = "Tavlelaget"): Promise<string> {
  const id = `tavle-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [id, navn, id]);
  ryddOrg.push(id);
  return id;
}

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try {
    await fn();
  } catch (e) {
    return e as ApiFeil;
  }
  throw new Error("Forventet feil, men kallet lyktes");
}

const medToken = (token: string) =>
  new Request("http://localhost/api/skjerm/innhold", { headers: { authorization: `Bearer ${token}` } });

/** Hele koblingen: skjermen ber om kode, styret skriver den inn, skjermen henter tokenet. */
async function kobletSkjerm(orgId: string, navn = "Oppgang A") {
  const k = await startKobling();
  ryddKoder.push(k.kode);
  const skjerm = await withOrg(orgId, (db) =>
    kobleSkjerm(db, orgId, KARI, { kode: k.kode, navn, adresse: null, retning: "staende" }),
  );
  const svar = await sjekkKobling(k.hemmelighet);
  if (svar.status !== "koblet") throw new Error(`Forventet koblet, fikk ${svar.status}`);
  return { skjerm, token: svar.token };
}

const iDag = osloIDag();
const periode = { fra: iDag, til: iDag, alleSkjermer: true, skjermIder: [] as string[], sekunder: 10 };

describe("kobling", () => {
  it("koden gir tokenet én gang, og skjermen ser sitt eget borettslag", async () => {
    const orgId = await nyOrg("Fjellveien Borettslag");
    const k = await startKobling();
    ryddKoder.push(k.kode);
    expect(await sjekkKobling(k.hemmelighet)).toEqual({ status: "venter" });

    await withOrg(orgId, (db) =>
      // Små bokstaver og bindestrek, slik det skrives av av en skjerm på veggen.
      kobleSkjerm(db, orgId, KARI, {
        kode: `${k.kode.slice(0, 3).toLowerCase()}-${k.kode.slice(3)}`,
        navn: "Oppgang A",
        adresse: "Fjellveien 12 A",
        retning: "staende",
      }),
    );
    const svar = await sjekkKobling(k.hemmelighet);
    expect(svar.status).toBe("koblet");
    // Hemmeligheten er brukt opp — den kan ikke gi et nytt token til en annen enhet.
    expect(await sjekkKobling(k.hemmelighet)).toEqual({ status: "utlopt" });

    const innhold = await innholdForSkjerm(medToken((svar as { token: string }).token));
    expect(innhold.org.navn).toBe("Fjellveien Borettslag");
    expect(innhold.skjerm.adresse).toBe("Fjellveien 12 A");
  });

  it("initialene hopper over tegn som ikke er ord («DEMO - Det Beste» → DD)", async () => {
    const orgId = await nyOrg("DEMO - Det Beste Borettslaget");
    const { token } = await kobletSkjerm(orgId);
    expect((await innholdForSkjerm(medToken(token))).org.initialer).toBe("DD");
  });

  it("en kode kan bare kobles én gang, og ukjente koder avvises likt", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const k = await startKobling();
    ryddKoder.push(k.kode);
    await withOrg(a, (db) => kobleSkjerm(db, a, KARI, { kode: k.kode, navn: "A", adresse: null, retning: "staende" }));

    const tattFeil = await feilFra(() =>
      withOrg(b, (db) => kobleSkjerm(db, b, KARI, { kode: k.kode, navn: "B", adresse: null, retning: "staende" })),
    );
    const ukjentFeil = await feilFra(() =>
      withOrg(b, (db) => kobleSkjerm(db, b, KARI, { kode: "ZZZZZZ", navn: "B", adresse: null, retning: "staende" })),
    );
    expect(tattFeil.status).toBe(400);
    expect(tattFeil.message).toBe(ukjentFeil.message);
  });

  it("en utløpt kode kan ikke kobles", async () => {
    const orgId = await nyOrg();
    const k = await startKobling();
    ryddKoder.push(k.kode);
    await eier.query("UPDATE board_pairings SET expires_at = now() - interval '1 minute' WHERE code = $1", [k.kode]);
    const feil = await feilFra(() =>
      withOrg(orgId, (db) => kobleSkjerm(db, orgId, KARI, { kode: k.kode, navn: "A", adresse: null, retning: "staende" })),
    );
    expect(feil.status).toBe(400);
  });

  it("koblingen logges i hendelsesloggen", async () => {
    const orgId = await nyOrg();
    await kobletSkjerm(orgId, "Oppgang C");
    const { rows } = await eier.query("SELECT event FROM audit_events WHERE org_id = $1", [orgId]);
    expect(rows.map((r) => r.event)).toContain("Koblet til skjermen «Oppgang C»");
  });

  it("en fjernet skjerm mister tilgangen med en gang", async () => {
    const orgId = await nyOrg();
    const { skjerm, token } = await kobletSkjerm(orgId);
    await withOrg(orgId, (db) => slettSkjerm(db, orgId, KARI, skjerm.id));
    expect((await feilFra(() => innholdForSkjerm(medToken(token)))).status).toBe(401);
  });

  it("uten token eller med feil token svarer skjermruta 401", async () => {
    expect((await feilFra(() => innholdForSkjerm(new Request("http://localhost/")))).status).toBe(401);
    expect((await feilFra(() => innholdForSkjerm(medToken("tull")))).status).toBe(401);
  });

  it("hver henting er et livstegn", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    await eier.query("UPDATE board_screens SET last_seen_at = now() - interval '1 hour' WHERE org_id = $1", [orgId]);
    expect((await withOrg(orgId, (db) => hentSkjermer(db, orgId)))[0]!.paaNett).toBe(false);
    await innholdForSkjerm(medToken(token));
    expect((await withOrg(orgId, (db) => hentSkjermer(db, orgId)))[0]!.paaNett).toBe(true);
  });
});

describe("hva skjermen viser", () => {
  it("bare oppslag i perioden og for denne skjermen", async () => {
    const orgId = await nyOrg();
    const a = await kobletSkjerm(orgId, "A");
    const b = await kobletSkjerm(orgId, "B");
    await withOrg(orgId, async (db) => {
      await opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Til alle" }, null);
      await opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Bare B", alleSkjermer: false, skjermIder: [b.skjerm.id] }, null);
      await opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Utløpt", fra: "2020-01-01", til: "2020-01-02" }, null);
      await opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Planlagt", fra: "2999-01-01", til: "2999-01-02" }, null);
    });
    const paaA = await innholdForSkjerm(medToken(a.token));
    const paaB = await innholdForSkjerm(medToken(b.token));
    expect(paaA.oppslag.map((p) => p.tittel)).toEqual(["Til alle"]);
    expect(paaB.oppslag.map((p) => p.tittel).sort()).toEqual(["Bare B", "Til alle"]);
  });

  it("et «alle skjermer»-oppslag gjelder også skjermer koblet til etterpå", async () => {
    const orgId = await nyOrg();
    await withOrg(orgId, (db) => opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Dugnad" }, null));
    const ny = await kobletSkjerm(orgId, "Ny");
    expect((await innholdForSkjerm(medToken(ny.token))).oppslag.map((p) => p.tittel)).toEqual(["Dugnad"]);
  });

  it("tokenet gir aldri et annet borettslags oppslag", async () => {
    const a = await nyOrg("Lag A");
    const b = await nyOrg("Lag B");
    const skjermA = await kobletSkjerm(a);
    await withOrg(b, async (db) => {
      await opprettOppslag(db, b, KARI, "tekst", { ...periode, tittel: "Hemmelig i B" }, null);
      await opprettHendelse(db, b, KARI, { tittel: "Møte i B", dato: iDag, tid: null, sted: null });
    });
    const innhold = await innholdForSkjerm(medToken(skjermA.token));
    expect(innhold.org.navn).toBe("Lag A");
    expect(innhold.oppslag).toEqual([]);
    expect(innhold.hendelser).toEqual([]);
  });

  it("et oppslag kan ikke peke på en annen orgs skjerm", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const fremmed = await kobletSkjerm(b);
    const feil = await feilFra(() =>
      withOrg(a, (db) =>
        opprettOppslag(db, a, KARI, "tekst", { ...periode, tittel: "x", alleSkjermer: false, skjermIder: [fremmed.skjerm.id] }, null),
      ),
    );
    expect(feil.status).toBe(400);
  });

  it("skjermen får bare bildene i sine egne oppslag", async () => {
    const orgId = await nyOrg();
    const a = await kobletSkjerm(orgId, "A");
    const b = await kobletSkjerm(orgId, "B");
    // Raden settes inn direkte — fila på disk er ikke poenget, gaten foran den er.
    const postId = randomUUID();
    await eier.query(
      `INSERT INTO board_posts (id, org_id, kind, title, file_name, show_from, show_until, all_screens, screen_ids, created_by)
       VALUES ($1,$2,'bilde','Bilde til B',$3,$4,$4,false,$5,'Kari')`,
      [postId, orgId, `${randomUUID()}.jpg`, iDag, [b.skjerm.id]],
    );
    const req = (t: string) => new Request("http://localhost/", { headers: { authorization: `Bearer ${t}` } });
    expect((await feilFra(() => filForSkjerm(req(a.token), postId))).message).toBe("Bilde ikke funnet");
    // B slipper gjennom gaten; fila finnes ikke på disk i testen.
    expect((await feilFra(() => filForSkjerm(req(b.token), postId))).message).toBe("Fil ikke funnet på disk");
  });

  it("passerte hendelser vises ikke", async () => {
    const orgId = await nyOrg();
    await withOrg(orgId, async (db) => {
      await opprettHendelse(db, orgId, KARI, { tittel: "I fjor", dato: "2020-05-01", tid: null, sted: null });
      await opprettHendelse(db, orgId, KARI, { tittel: "Framover", dato: "2999-05-01", tid: "18:30", sted: "Fellesrommet" });
    });
    expect((await withOrg(orgId, (db) => hentHendelser(db, orgId))).map((h) => h.title)).toEqual(["Framover"]);
  });
});

describe("visningstid og redigering", () => {
  it("hvert oppslag bærer sin egen visningstid til skjermen", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    await withOrg(orgId, async (db) => {
      await opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Kort", sekunder: 5 }, null);
      await opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Lang", sekunder: 30 }, null);
    });
    const tider = (await innholdForSkjerm(medToken(token))).oppslag.map((p) => [p.tittel, p.sekunder]);
    expect(tider.sort()).toEqual([["Kort", 5], ["Lang", 30]]);
  });

  it("bare de faste visningstidene godtas", () => {
    const grunn = { tittel: "x", fra: iDag, til: iDag, alleSkjermer: true };
    expect(oppslagInn.safeParse({ ...grunn, sekunder: 7 }).success).toBe(false);
    expect(oppslagInn.safeParse({ ...grunn, sekunder: 15 }).success).toBe(true);
    expect(oppslagInn.parse(grunn).sekunder).toBe(10);
  });

  it("et oppslag kan endres — tid, periode og skjermer", async () => {
    const orgId = await nyOrg();
    const a = await kobletSkjerm(orgId, "A");
    const b = await kobletSkjerm(orgId, "B");
    const p = await withOrg(orgId, (db) => opprettOppslag(db, orgId, KARI, "tekst", { ...periode, tittel: "Før" }, null));
    await withOrg(orgId, (db) =>
      endreOppslag(db, orgId, p.id, { ...periode, tittel: "Etter", alleSkjermer: false, skjermIder: [b.skjerm.id], sekunder: 45 }),
    );
    expect((await innholdForSkjerm(medToken(a.token))).oppslag).toEqual([]);
    const paaB = (await innholdForSkjerm(medToken(b.token))).oppslag;
    expect(paaB.map((x) => [x.tittel, x.sekunder])).toEqual([["Etter", 45]]);
  });

  it("et oppslag i en annen org kan ikke endres", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const p = await withOrg(b, (db) => opprettOppslag(db, b, KARI, "tekst", { ...periode, tittel: "B" }, null));
    const feil = await feilFra(() => withOrg(a, (db) => endreOppslag(db, a, p.id, { ...periode, tittel: "Kapret" })));
    expect(feil.status).toBe(404);
  });
});

describe("kontaktpersoner", () => {
  /** En DriftIQ-bruker med medlemskap i orgen. Ryddes av `afterEach` via `ryddBrukere`. */
  async function nyBruker(orgId: string | null, navn: string, telefon: string | null, tittel: string | null = null) {
    const id = randomUUID();
    await eier.query(
      `INSERT INTO users (id, name, email, phone, role, active, email_verified, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'member',true,true,now(),now())`,
      [id, navn, `${id}@driftiq.test`, telefon],
    );
    ryddBrukere.push(id);
    if (orgId) {
      await eier.query(
        "INSERT INTO user_org_memberships (id, user_id, org_id, role, title) VALUES ($1,$2,$3,'visning',$4)",
        [randomUUID(), id, orgId, tittel],
      );
    }
    return id;
  }

  it("uten kontaktpersoner viser skjermen borettslagets egen kontaktinfo", async () => {
    const orgId = await nyOrg();
    await eier.query("UPDATE organizations SET phone = '22 22 22 22' WHERE id = $1", [orgId]);
    const { token } = await kobletSkjerm(orgId);
    const innhold = await innholdForSkjerm(medToken(token));
    expect(innhold.kontakter).toEqual([]);
    expect(innhold.org.telefon).toBe("22 22 22 22");
  });

  it("navn, telefon og rolle kommer ferskt fra profil og medlemskap", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    const kari = await nyBruker(orgId, "Kari Nilsen", "900 00 000", "Styreleder");
    await withOrg(orgId, (db) => opprettKontakt(db, orgId, { brukerId: kari, visTelefon: true, visEpost: false }, null));
    await eier.query("UPDATE users SET phone = '911 11 111' WHERE id = $1", [kari]);
    expect((await innholdForSkjerm(medToken(token))).kontakter).toMatchObject([
      { navn: "Kari Nilsen", rolle: "Styreleder", telefon: "911 11 111", epost: null },
    ]);
  });

  it("skjult telefon og e-post sendes aldri til skjermen", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    const ola = await nyBruker(orgId, "Ola", "922 22 222");
    const k = await withOrg(orgId, (db) => opprettKontakt(db, orgId, { brukerId: ola, visTelefon: false, visEpost: false }, null));
    const paaSkjermen = (await innholdForSkjerm(medToken(token))).kontakter[0]!;
    expect(paaSkjermen.telefon).toBeNull();
    expect(paaSkjermen.epost).toBeNull();
    expect(JSON.stringify(await innholdForSkjerm(medToken(token)))).not.toContain("922 22 222");
    // Styret ser fortsatt hva profilen har, og kan slå det på.
    await withOrg(orgId, (db) => endreKontakt(db, orgId, k.id, { visTelefon: true, visEpost: true }));
    expect((await innholdForSkjerm(medToken(token))).kontakter[0]).toMatchObject({ telefon: "922 22 222", epost: `${ola}@driftiq.test` });
  });

  it("bare medlemmer av orgen kan velges, og hver person bare én gang", async () => {
    const orgId = await nyOrg();
    const annen = await nyOrg();
    const fremmed = await nyBruker(annen, "Fremmed", "933 33 333");
    const feil = await feilFra(() =>
      withOrg(orgId, (db) => opprettKontakt(db, orgId, { brukerId: fremmed, visTelefon: true, visEpost: true }, null)),
    );
    expect(feil.status).toBe(400);
    const kari = await nyBruker(orgId, "Kari", null);
    await withOrg(orgId, (db) => opprettKontakt(db, orgId, { brukerId: kari, visTelefon: true, visEpost: false }, null));
    const dobbel = await feilFra(() =>
      withOrg(orgId, (db) => opprettKontakt(db, orgId, { brukerId: kari, visTelefon: true, visEpost: false }, null)),
    );
    expect(dobbel.message).toMatch(/allerede/);
  });

  it("en som ikke lenger er medlem eller er deaktivert, forsvinner fra veggen", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    const a = await nyBruker(orgId, "Går ut", "1");
    const b = await nyBruker(orgId, "Deaktivert", "2");
    await withOrg(orgId, async (db) => {
      await opprettKontakt(db, orgId, { brukerId: a, visTelefon: true, visEpost: false }, null);
      await opprettKontakt(db, orgId, { brukerId: b, visTelefon: true, visEpost: false }, null);
    });
    await eier.query("DELETE FROM user_org_memberships WHERE user_id = $1", [a]);
    await eier.query("UPDATE users SET active = false WHERE id = $1", [b]);
    expect((await innholdForSkjerm(medToken(token))).kontakter).toEqual([]);
  });

  it("kontaktpersonene kommer i valgt rekkefølge", async () => {
    const orgId = await nyOrg();
    const { token } = await kobletSkjerm(orgId);
    const forste = await withOrg(orgId, async (db) =>
      opprettKontakt(db, orgId, { brukerId: await nyBruker(orgId, "Kari", "1"), visTelefon: true, visEpost: false }, null),
    );
    const andre = await withOrg(orgId, async (db) =>
      opprettKontakt(db, orgId, { brukerId: await nyBruker(orgId, "Ola", "2"), visTelefon: true, visEpost: false }, null),
    );
    expect((await innholdForSkjerm(medToken(token))).kontakter.map((k) => k.navn)).toEqual(["Kari", "Ola"]);
    await withOrg(orgId, (db) => flyttKontakt(db, orgId, andre.id, "opp"));
    expect((await innholdForSkjerm(medToken(token))).kontakter.map((k) => k.id)).toEqual([andre.id, forste.id]);
    await withOrg(orgId, (db) => slettKontakt(db, orgId, andre.id));
    expect((await withOrg(orgId, (db) => hentKontakter(db, orgId))).map((k) => k.id)).toEqual([forste.id]);
  });

  it("skjermen får aldri et annet borettslags kontaktbilde", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    const skjermA = await kobletSkjerm(a);
    const kontaktB = await withOrg(b, async (db) =>
      opprettKontakt(db, b, { brukerId: await nyBruker(b, "Kari", "1"), visTelefon: true, visEpost: false }, null),
    );
    await eier.query("UPDATE board_contacts SET file_name = $1 WHERE id = $2", [`${randomUUID()}.jpg`, kontaktB.id]);
    const feil = await feilFra(() => kontaktbildeForSkjerm(medToken(skjermA.token), kontaktB.id));
    expect(feil.message).toBe("Kontaktperson ikke funnet");
  });
});

describe("regler", () => {
  it("status følger datoene, inklusive i begge ender", () => {
    expect(oppslagStatus({ showFrom: "2026-09-29", showUntil: "2026-09-29" }, "2026-09-29")).toBe("na");
    expect(oppslagStatus({ showFrom: "2026-09-30", showUntil: "2026-10-01" }, "2026-09-29")).toBe("planlagt");
    expect(oppslagStatus({ showFrom: "2026-09-01", showUntil: "2026-09-28" }, "2026-09-29")).toBe("utlopt");
  });


  it("koden normaliseres før oppslag", () => {
    expect(normaliserKode(" k7m-4qx ")).toBe("K7M4QX");
  });

  it("aksentteksten får lesbar kontrast også med lys aksent på lys bakgrunn", () => {
    const p = skjermpalett("#f4f7fb", "#fff2a8");
    expect(p["--s-accent-t"]).not.toBe("#fff2a8");
    expect(p["--s-fg"]).toBe("#0f1a2c");
  });
});
