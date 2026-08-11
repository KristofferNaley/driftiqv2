/**
 * Avvik — reglene fra v1s `routers/deviations.py`.
 *
 * Tyngdepunktet er dokumentasjonskjeden: beskrivelse → behandling → løsning er det som
 * havner i internkontrollpermen (§ 5 pkt. 7). Den er bare troverdig hvis den ikke kan
 * redigeres i ettertid, og hvis et avvik ikke kan lukkes uten begrunnelse.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  avvikSok,
  avvikPerEnhet,
  endreAvvik,
  hentAvvik,
  hentEttAvvik,
  leggTilBehandling,
  lukkAvvik,
  opprettAvvik,
  tellPerStatus,
} from "../src/lib/avvik";
import { anonymAktor } from "../src/lib/aktor";

/** Aktøren i testene: navn uten konto. Id-koblingen testes i aktivitet.test.ts. */
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
    await eier.query(
      `DELETE FROM deviation_logs WHERE deviation_id IN (SELECT id FROM deviations WHERE org_id = $1)`,
      [id],
    );
    await eier.query(
      `DELETE FROM deviation_treatments WHERE deviation_id IN (SELECT id FROM deviations WHERE org_id = $1)`,
      [id],
    );
    await eier.query("DELETE FROM deviations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM units WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function nyOrg(): Promise<string> {
  const id = `avvik-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    id, "Avvikslaget", id,
  ]);
  ryddOrg.push(id);
  return id;
}

async function nyBrukerIOrg(orgId: string | null, navn: string): Promise<string> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,$2,$3,'member',true,true,now(),now())`,
    [id, navn, `${id}@driftiq.test`],
  );
  if (orgId) {
    await eier.query(
      "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'redigering')",
      [randomUUID(), id, orgId],
    );
  }
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

const grunn = { title: "Fukt i kjeller" };

describe("løpenummer", () => {
  it("teller opp per org", async () => {
    const org = await nyOrg();
    const a = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    const b = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
  });

  it("teller uavhengig i hver org", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await i(a, (db) => opprettAvvik(db, a, KARI, grunn));
    await i(a, (db) => opprettAvvik(db, a, KARI, grunn));
    const iB = await i(b, (db) => opprettAvvik(db, b, KARI, grunn));
    expect(iB.number).toBe(1);
  });
});

describe("ansvarlig", () => {
  it("krever medlemskap i org-en", async () => {
    // Uten dette kunne et avvik tildeles noen i et annet borettslag, og de ville sett det
    // i «mine avvik».
    const org = await nyOrg();
    const utenfor = await nyBrukerIOrg(null, "Utenforstående");

    const feil = await feilFra(() =>
      i(org, (db) => opprettAvvik(db, org, KARI, { ...grunn, responsibleUserId: utenfor })),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/medlem av organisasjonen/i);
  });

  it("viser brukerens NÅVÆRENDE navn, ikke det lagrede", async () => {
    const org = await nyOrg();
    const bruker = await nyBrukerIOrg(org, "Ola Gammelnavn");
    const avvik = await i(org, (db) =>
      opprettAvvik(db, org, KARI, { ...grunn, responsibleUserId: bruker }),
    );
    expect(avvik.assignedTo).toBe("Ola Gammelnavn");

    await eier.query("UPDATE users SET name = 'Ola Nyttnavn' WHERE id = $1", [bruker]);

    const etter = await i(org, (db) => hentEttAvvik(db, org, avvik.id));
    expect(etter.assignedTo, "Navnebytte ga feil visning").toBe("Ola Nyttnavn");
  });
});

describe("lukking", () => {
  it("kan ikke settes til lukket via vanlig endring", async () => {
    // Zod-skjemaet tillater bare `ny` og `under_behandling`. Kravet om løsningsbeskrivelse
    // ville vært trivielt å omgå hvis status var et vanlig felt.
    const org = await nyOrg();
    const avvik = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));

    const { avvikEndring } = await import("../src/lib/avvik");
    expect(avvikEndring.safeParse({ status: "lukket" }).success).toBe(false);
    expect(avvikEndring.safeParse({ status: "under_behandling" }).success).toBe(true);
    expect(avvik.status).toBe("ny");
  });

  it("krever en løsningsbeskrivelse", async () => {
    const { lukkInn } = await import("../src/lib/avvik");
    const resultat = lukkInn.safeParse({ resolutionNotes: "   " });
    expect(resultat.success).toBe(false);
  });

  it("setter status, tidspunkt og logg", async () => {
    const org = await nyOrg();
    const avvik = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    await i(org, (db) =>
      lukkAvvik(db, org, avvik.id, KARI, { resolutionNotes: "Drenert og tørket" }),
    );

    const etter = await i(org, (db) => hentEttAvvik(db, org, avvik.id));
    expect(etter.status).toBe("lukket");
    expect(etter.resolvedAt).not.toBeNull();
    expect(etter.logg.at(-1)!.event).toMatch(/lukket av Kari.*Drenert/i);
  });

  it("registrerer den innloggede som lukket-av", async () => {
    const org = await nyOrg();
    const avvik = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    await i(org, (db) => lukkAvvik(db, org, avvik.id, KARI, { resolutionNotes: "Fikset" }));

    const etter = await i(org, (db) => hentEttAvvik(db, org, avvik.id));
    // Ikke et fritekstfelt lenger: hvem som lukket er et faktum, ikke en påstand.
    expect(etter.resolvedBy).toBe("Kari");
  });

  it("hindrer endring av et lukket avvik — unntatt merkelappene", async () => {
    const org = await nyOrg();
    const avvik = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    await i(org, (db) => lukkAvvik(db, org, avvik.id, KARI, { resolutionNotes: "Fikset" }));

    const feil = await feilFra(() =>
      i(org, (db) => endreAvvik(db, org, avvik.id, anonymAktor("Kari"), { title: "Omskrevet i ettertid" })),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/lukket/i);

    // Kategori, alvorlighet og sted er statistikk-merkelapper og skal kunne rettes i
    // etterkant — og endringen skal stå i historikken.
    const unitId = randomUUID();
    await eier.query("INSERT INTO units (id, org_id, type, leilighetsnr) VALUES ($1,$2,'bolig','H0304')", [unitId, org]);
    await i(org, (db) => endreAvvik(db, org, avvik.id, KARI, { category: "hms", severity: "akutt", unitId }));

    const etter = await i(org, (db) => hentEttAvvik(db, org, avvik.id));
    expect(etter.category).toBe("hms");
    expect(etter.severity).toBe("akutt");
    expect(etter.unitId).toBe(unitId);
    const hendelser = etter.logg.map((l) => l.event).join(" | ");
    expect(hendelser).toMatch(/Kategori endret til «hms» av Kari/);
    expect(hendelser).toMatch(/Sted satt til «H0304» av Kari/);
  });

  it("hindrer at behandlingen fortsetter etter lukking", async () => {
    const org = await nyOrg();
    const avvik = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    await i(org, (db) => lukkAvvik(db, org, avvik.id, KARI, { resolutionNotes: "Fikset" }));

    const feil = await feilFra(() =>
      i(org, (db) => leggTilBehandling(db, org, avvik.id, KARI, { text: "Etterpåklokskap" })),
    );
    expect(feil.message).toMatch(/behandlingen kan ikke fortsette/i);
  });
});

describe("behandlingsjournal", () => {
  it("flytter avviket til under_behandling ved første innlegg", async () => {
    const org = await nyOrg();
    const avvik = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    await i(org, (db) => leggTilBehandling(db, org, avvik.id, anonymAktor("Ola"), { text: "Ringt rørlegger" }));

    const etter = await i(org, (db) => hentEttAvvik(db, org, avvik.id));
    expect(etter.status).toBe("under_behandling");
    expect(etter.behandlinger).toHaveLength(1);
    expect(etter.behandlinger[0]!.createdBy).toBe("Ola");
  });

  it("beholder rekkefølgen på innleggene", async () => {
    const org = await nyOrg();
    const avvik = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    await i(org, (db) => leggTilBehandling(db, org, avvik.id, anonymAktor("Ola"), { text: "Først" }));
    await i(org, (db) => leggTilBehandling(db, org, avvik.id, anonymAktor("Ola"), { text: "Så" }));

    const etter = await i(org, (db) => hentEttAvvik(db, org, avvik.id));
    expect(etter.behandlinger.map((b) => b.text)).toEqual(["Først", "Så"]);
  });
});

describe("oversikter", () => {
  it("filtrerer på åpne og lukkede", async () => {
    const org = await nyOrg();
    const a = await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    await i(org, (db) => opprettAvvik(db, org, KARI, { title: "Åpent" }));
    await i(org, (db) => lukkAvvik(db, org, a.id, KARI, { resolutionNotes: "Fikset" }));

    expect((await i(org, (db) => hentAvvik(db, org, { lukkede: false }))).total).toBe(1);
    expect((await i(org, (db) => hentAvvik(db, org, { lukkede: true }))).total).toBe(1);
    expect((await i(org, (db) => hentAvvik(db, org))).total).toBe(2);
  });

  it("søker på tittel og på løpenummer", async () => {
    const org = await nyOrg();
    const a = await i(org, (db) => opprettAvvik(db, org, KARI, { title: "Lekkasje i kjeller" }));
    await i(org, (db) => opprettAvvik(db, org, KARI, { title: "Rekkverk løst" }));

    const tittel = await i(org, (db) => hentAvvik(db, org, { sok: "lekkasje" }));
    expect(tittel.items.map((r) => r.id)).toEqual([a.id]);

    // «#1» skal treffe løpenummeret, ikke lete etter tallet inne i titlene.
    const nummer = await i(org, (db) => hentAvvik(db, org, { sok: `#${a.number}` }));
    expect(nummer.items.map((r) => r.id)).toEqual([a.id]);
  });

  it("filtrerer på kategori", async () => {
    const org = await nyOrg();
    const a = await i(org, (db) => opprettAvvik(db, org, KARI, { title: "A", category: "hms" }));
    await i(org, (db) => opprettAvvik(db, org, KARI, { title: "B", category: "teknisk" }));
    const ut = await i(org, (db) => hentAvvik(db, org, { kategori: "hms" }));
    expect(ut.items.map((r) => r.id)).toEqual([a.id]);
  });

  it("faller tilbake til standardsortering på et ukjent sorteringsfelt", async () => {
    // Feltet kommer fra en URL-parameter. Uten hvitelista ville dette vært en SQL-injeksjon;
    // testen slår fast at ukjent input gir et normalt svar, ikke en feil eller rar SQL.
    const org = await nyOrg();
    await i(org, (db) => opprettAvvik(db, org, KARI, { title: "A" }));
    const ut = await i(org, (db) =>
      hentAvvik(db, org, { sorter: "title; DROP TABLE deviations" }),
    );
    expect(ut.total).toBe(1);
  });

  it("paginerer, og teller totalen uavhengig av siden", async () => {
    const org = await nyOrg();
    for (let n = 0; n < 3; n++) {
      await i(org, (db) => opprettAvvik(db, org, KARI, { title: `Avvik ${n}` }));
    }
    const side1 = await i(org, (db) => hentAvvik(db, org, { side: 1 }));
    expect(side1.total).toBe(3);
    expect(side1.sider).toBe(1);
    expect(side1.items).toHaveLength(3);
  });

  it("teller åpne avvik per enhet", async () => {
    // Dette er feltet Enhetsregisteret har ventet på.
    const org = await nyOrg();
    const unitId = randomUUID();
    await eier.query("INSERT INTO units (id, org_id, type, andelsnr) VALUES ($1,$2,'bolig','1')", [
      unitId, org,
    ]);
    const a = await i(org, (db) => opprettAvvik(db, org, KARI, { ...grunn, unitId }));
    await i(org, (db) => opprettAvvik(db, org, KARI, { ...grunn, unitId }));
    await i(org, (db) => lukkAvvik(db, org, a.id, KARI, { resolutionNotes: "Fikset" }));

    const kart = await i(org, (db) => avvikPerEnhet(db, org));
    expect(kart.get(unitId)?.apne, "Lukkede avvik skal ikke telles som åpne").toBe(1);
    expect(kart.get(unitId)?.totalt, "…men de telles i totalen — den er historikken").toBe(2);
  });

  it("teller per status", async () => {
    const org = await nyOrg();
    await i(org, (db) => opprettAvvik(db, org, KARI, grunn));
    expect(await i(org, (db) => tellPerStatus(db, org))).toEqual({ ny: 1 });
  });
});


describe("avvikSok", () => {
  it("tolker «false» fra URL-en som usant", () => {
    // `z.coerce.boolean()` ville gitt `true` her: en ikke-tom streng er sann i JS. Feilen
    // var at «Aktive» viste de LUKKEDE avvikene.
    expect(avvikSok.parse({ lukkede: "false" }).lukkede).toBe(false);
    expect(avvikSok.parse({ lukkede: "true" }).lukkede).toBe(true);
    expect(avvikSok.parse({}).lukkede).toBe(false);
  });

  it("faller tilbake til side 1 og standardsortering uten parametre", () => {
    const ut = avvikSok.parse({});
    expect(ut.side).toBe(1);
    expect(ut.sorter).toBe("reported_at");
    expect(ut.retning).toBe("desc");
  });

  it("viser melderens NÅVÆRENDE navn, men beholder snapshotet i basen", async () => {
    // Regelen som allerede gjaldt for ansvarlig, nå også for melder og behandlingsforfatter:
    // har raden en bruker-id, vinner personens nåværende navn ved LESING. Kolonnen skrives
    // aldri om — den er protokollen, og reserven for rader uten id (QR-anonym, slettet konto).
    const org = await nyOrg();
    const brukerId = await nyBrukerIOrg(org, "Kari Nordmann");
    const melder = { navn: "Kari Nordmann", brukerId };

    const avvik = await i(org, (db) => opprettAvvik(db, org, melder, grunn));
    await i(org, (db) => leggTilBehandling(db, org, avvik.id, melder, { text: "Ringt rørlegger" }));

    await eier.query("UPDATE users SET name = $1 WHERE id = $2", ["Kari Nordmann-Hansen", brukerId]);

    const etter = await i(org, (db) => hentEttAvvik(db, org, avvik.id));
    expect(etter.reportedBy).toBe("Kari Nordmann-Hansen");
    expect(etter.behandlinger[0]!.createdBy).toBe("Kari Nordmann-Hansen");

    const rad = await eier.query("SELECT reported_by FROM deviations WHERE id = $1", [avvik.id]);
    expect(rad.rows[0].reported_by).toBe("Kari Nordmann");
  });
});
