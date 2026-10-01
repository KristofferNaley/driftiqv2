/**
 * «I dag» i plattformpanelet. Ingen v1-forgjenger — bygget fra backlog-kortet om ny meny i
 * plattformadmin og mockupen.
 *
 * Tyngdepunktet er regelsettet i `lib/idag.ts` som rene funksjoner: hver regel gir punkt når
 * den skal og ingenting ellers, og grensene (85 %, én arbeidsdag) holder på kanten. Til slutt
 * mot databasen: telleren på Innmeldinger følger «Ubesvart», og `hentKreverHandling` finner
 * en kunde uten e-post og en ubesvart sak, men ikke demo-kunder.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import { antallVenterPaSvar } from "../src/lib/feilmelding";
import { hentKreverHandling } from "../src/lib/plattform";
import {
  DISK_GRENSE_PROSENT,
  STILLE_SAK_DAGER,
  arbeidsdagerMellom,
  kreverHandling,
  sidenSistTekst,
  type IDagGrunnlag,
} from "../src/lib/idag";

// ── Regelsettet ─────────────────────────────────────────────────────────────────────────

/** Torsdag 1. oktober 2026, 12:00 norsk tid. */
const NAA = new Date("2026-10-01T10:00:00Z");
const dagerFor = (n: number) => new Date(NAA.getTime() - n * 24 * 60 * 60 * 1000);

const TOMT: IDagGrunnlag = { disk: null, jobber: [], saker: [], kunder: [], supportokter: [] };
const g = (endring: Partial<IDagGrunnlag>): IDagGrunnlag => ({ ...TOMT, ...endring });

const sak = (endring: Partial<IDagGrunnlag["saker"][number]> = {}) => ({
  id: "s1",
  nummer: 3,
  status: "ny",
  orgNavn: "Laget",
  opprettet: dagerFor(5),
  sisteSvar: null,
  ...endring,
});

describe("arbeidsdagerMellom", () => {
  it("teller hverdager etter meldedagen, ikke helg", () => {
    // Mandag 28.09 → tirsdag 1, onsdag 2.
    const mandag = new Date("2026-09-28T08:00:00Z");
    expect(arbeidsdagerMellom(mandag, new Date("2026-09-28T20:00:00Z"))).toBe(0);
    expect(arbeidsdagerMellom(mandag, new Date("2026-09-29T08:00:00Z"))).toBe(1);
    expect(arbeidsdagerMellom(mandag, new Date("2026-09-30T08:00:00Z"))).toBe(2);
    // Fredag 25.09 → mandag 28.09 er én arbeidsdag.
    expect(arbeidsdagerMellom(new Date("2026-09-25T14:00:00Z"), mandag)).toBe(1);
  });

  it("regner datogrensen i norsk tid", () => {
    // 22:30 UTC mandag er tirsdag i Norge — da har ingen arbeidsdag gått før onsdag.
    const tirsdagNorsk = new Date("2026-09-28T22:30:00Z");
    expect(arbeidsdagerMellom(tirsdagNorsk, new Date("2026-09-29T15:00:00Z"))).toBe(0);
  });
});

describe("kreverHandling", () => {
  it("gir ingen punkter når alt er i orden", () => {
    expect(kreverHandling(TOMT, NAA)).toEqual([]);
  });

  it("disk: punkt over grensen, ikke på den", () => {
    const disk = (prosent: number) => ({ prosent, bruktGb: 34.6, totaltGb: 37.1 });
    expect(kreverHandling(g({ disk: disk(DISK_GRENSE_PROSENT) }), NAA)).toEqual([]);
    const [p] = kreverHandling(g({ disk: disk(93) }), NAA);
    expect(p).toMatchObject({
      nokkel: "disk",
      tittel: "Disk på verten er 93 % full",
      forklaring: "34,6 av 37,1 GB brukt.",
      knapp: { etikett: "Åpne System", href: "/plattform/innstillinger/system" },
    });
  });

  it("jobb: bare når SISTE kjøring feilet, med tidspunkt i norsk tid", () => {
    const naar = new Date("2026-10-01T05:00:00Z");
    const jobber = [
      { nokkel: "varsler", navn: "Varselsjobb", siste: { naar, ok: false, detail: "Tidsavbrudd\nstack" } },
      { nokkel: "fiken-synk", navn: "Fiken-synk", siste: { naar, ok: true, detail: null } },
      { nokkel: "backup", navn: "Backup", siste: null },
    ];
    const punkter = kreverHandling(g({ jobber }), NAA);
    expect(punkter).toHaveLength(1);
    expect(punkter[0]).toMatchObject({
      nokkel: "jobb:varsler",
      tittel: "Varselsjobb feilet tor. 1. okt. 07:00",
      forklaring: "Tidsavbrudd",
    });
  });

  it("ubesvart innmelding: punkt først etter mer enn én arbeidsdag", () => {
    // Meldt tirsdag 29.09: onsdag og torsdag er gått, altså to. Meldt onsdag: bare én.
    const tirsdag = new Date("2026-09-29T08:00:00Z");
    const onsdag = new Date("2026-09-30T08:00:00Z");
    expect(kreverHandling(g({ saker: [sak({ opprettet: onsdag })] }), NAA)).toEqual([]);
    const [p] = kreverHandling(g({ saker: [sak({ opprettet: tirsdag })] }), NAA);
    expect(p).toMatchObject({
      nokkel: "ubesvart:s1",
      tittel: "FM-0003 har ventet på svar i 2 dager",
      knapp: { etikett: "Åpne innmelding", href: "/plattform/saker?apen=s1" },
    });
  });

  it("besvart sak er ikke ubesvart, men blir et punkt når den har stått stille", () => {
    const fersk = sak({ status: "under_arbeid", sisteSvar: dagerFor(2), opprettet: dagerFor(46) });
    expect(kreverHandling(g({ saker: [fersk] }), NAA)).toEqual([]);

    const stille = { ...fersk, sisteSvar: dagerFor(STILLE_SAK_DAGER) };
    const [p] = kreverHandling(g({ saker: [stille] }), NAA);
    expect(p).toMatchObject({ nokkel: "stille:s1", nivaa: "gul", tittel: "FM-0003 har vært under arbeid i 46 dager" });

    // «Venter på kunde»: ballen er hos dem.
    expect(kreverHandling(g({ saker: [{ ...stille, status: "venter_kunde" }] }), NAA)).toEqual([]);
  });

  it("kunde uten e-post: blank teller som manglende", () => {
    const kunder = [
      { id: "a", navn: "Det Beste Borettslaget", epost: null },
      { id: "b", navn: "Blankt", epost: "  " },
      { id: "c", navn: "Har", epost: "styret@laget.no" },
    ];
    const punkter = kreverHandling(g({ kunder }), NAA);
    expect(punkter.map((p) => p.nokkel)).toEqual(["epost:a", "epost:b"]);
    expect(punkter[0]).toMatchObject({
      tittel: "Det Beste Borettslaget mangler e-post",
      knapp: { etikett: "Åpne kunden", href: "/plattform/kunder/a" },
    });
  });

  it("aktiv support-økt: utløpstid i norsk tid", () => {
    const supportokter = [
      { orgId: "o", orgNavn: "Laget", adminNavn: "Kari", utloper: new Date("2026-10-01T12:30:00Z") },
    ];
    const [p] = kreverHandling(g({ supportokter }), NAA);
    expect(p).toMatchObject({ tittel: "Support-modus aktiv hos Laget, utløper 14:30", nivaa: "gul" });
  });

  it("røde punkter står før gule", () => {
    const punkter = kreverHandling(
      g({
        supportokter: [{ orgId: "o", orgNavn: "L", adminNavn: "K", utloper: NAA }],
        kunder: [{ id: "a", navn: "A", epost: null }],
      }),
      NAA,
    );
    expect(punkter.map((p) => p.nivaa)).toEqual(["rod", "gul"]);
  });
});

describe("sidenSistTekst", () => {
  it("viser bare det som ikke er 0", () => {
    expect(sidenSistTekst({ leads: 2, innmeldinger: 0, supportokter: 1 })).toBe("2 nye leads og 1 support-økt.");
    expect(sidenSistTekst({ leads: 1, innmeldinger: 1, supportokter: 0 })).toBe("1 nytt lead og 1 ny innmelding.");
  });

  it("har egen tekst når ingenting har skjedd", () => {
    expect(sidenSistTekst({ leads: 0, innmeldinger: 0, supportokter: 0 })).toBe(
      "Ingen nye leads, innmeldinger eller support-økter.",
    );
  });
});

// ── Mot databasen ───────────────────────────────────────────────────────────────────────

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
});

afterEach(async () => {
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM feedback_messages WHERE report_id IN (SELECT id FROM feedback_reports WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM feedback_reports WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

async function nyOrg(demo = false): Promise<string> {
  const id = randomUUID();
  await eier.query(
    "INSERT INTO organizations (id, name, slug, active, demo) VALUES ($1,$2,$3,true,$4)",
    [id, `Idag-test ${id.slice(0, 8)}`, `idag-${id}`, demo],
  );
  ryddOrg.push(id);
  return id;
}

async function nySak(orgId: string, opprettet: Date): Promise<string> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO feedback_reports (id, number, org_id, kind, description, status, reported_by_name, created_at)
     VALUES ($1, NULL, $2, 'bug', 'Test av I dag', 'ny', 'Test', $3)`,
    [id, orgId, opprettet],
  );
  return id;
}

describe("telleren på Innmeldinger", () => {
  it("teller ubesvarte, og slutter å telle når kunden har fått svar — ikke ved et internt notat", async () => {
    const orgId = await nyOrg();
    const for_ = await withoutRls("plattformpanel", (db) => antallVenterPaSvar(db));
    const sakId = await nySak(orgId, new Date());
    expect(await withoutRls("plattformpanel", (db) => antallVenterPaSvar(db))).toBe(for_ + 1);

    await eier.query(
      "INSERT INTO feedback_messages (id, report_id, internal, author_name, body) VALUES ($1,$2,true,'Oss','Notat')",
      [randomUUID(), sakId],
    );
    expect(await withoutRls("plattformpanel", (db) => antallVenterPaSvar(db))).toBe(for_ + 1);

    await eier.query(
      "INSERT INTO feedback_messages (id, report_id, internal, author_name, body) VALUES ($1,$2,false,'Oss','Svar')",
      [randomUUID(), sakId],
    );
    expect(await withoutRls("plattformpanel", (db) => antallVenterPaSvar(db))).toBe(for_);
  });

  it("teller ikke løste saker", async () => {
    const orgId = await nyOrg();
    const for_ = await withoutRls("plattformpanel", (db) => antallVenterPaSvar(db));
    const sakId = await nySak(orgId, new Date());
    await eier.query("UPDATE feedback_reports SET status = 'lost' WHERE id = $1", [sakId]);
    expect(await withoutRls("plattformpanel", (db) => antallVenterPaSvar(db))).toBe(for_);
  });
});

describe("hentKreverHandling", () => {
  it("finner kunde uten e-post og ubesvart sak, men ikke demo-kunder", async () => {
    const ekte = await nyOrg(false);
    const demo = await nyOrg(true);
    const sakId = await nySak(ekte, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    const punkter = await withoutRls("plattformpanel", (db) => hentKreverHandling(db, new Date()));
    const nokler = punkter.map((p) => p.nokkel);
    expect(nokler).toContain(`epost:${ekte}`);
    expect(nokler).toContain(`ubesvart:${sakId}`);
    expect(nokler).not.toContain(`epost:${demo}`);
  });
});
