/**
 * Plattformpanelet og support-sesjonene.
 *
 * Gaten selv — at plattformadmin nektes uten sesjon og slippes inn med — er dekket i
 * `tilgang.test.ts`. Her testes laget som OPPRETTER og avslutter sesjonene, og særlig de to
 * egenskapene innsynsloggen står og faller på:
 *
 *  1. Navnet KOPIERES inn, så loggen overlever at plattformbrukeren slettes.
 *  2. Man kan bare avslutte SINE EGNE sesjoner — ellers kunne en kollega lukket et pågående
 *     innsyn og gjort loggen misvisende om hvor lenge det varte.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  avsluttSupport,
  endrePlattformbruker,
  hentKunde,
  hentKunder,
  hentPlattformbrukere,
  opprettPlattformbruker,
  startSupport,
} from "../src/lib/plattform";
import { SUPPORT_SESJON_MAKS_TIMER } from "../src/lib/tilgang";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const ryddBruker: string[] = [];

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
  // Sett tilbake alle vi midlertidig degraderte, FØR noe annet ryddes.
  for (const id of gjemte.splice(0)) {
    await eier.query("UPDATE users SET role = 'superadmin' WHERE id = $1", [id]);
  }
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM support_access_log WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) {
    await eier.query("DELETE FROM support_access_log WHERE superadmin_id = $1", [id]);
    await eier.query("DELETE FROM users WHERE id = $1", [id]);
  }
});

async function nyOrg(navn = "Testlaget"): Promise<string> {
  const id = `pf-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$1,true)", [id, navn]);
  ryddOrg.push(id);
  return id;
}

async function nyAdmin(navn = "Plattform Admin"): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  await eier.query(
    `INSERT INTO users (id, name, email, role, active, email_verified, created_at, updated_at)
     VALUES ($1,$2,$3,'superadmin',true,true,now(),now())`,
    [id, navn, `${id}@driftiq.test`],
  );
  ryddBruker.push(id);
  return { id, name: navn };
}

const i = <T>(fn: (db: Parameters<Parameters<typeof withoutRls>[1]>[0]) => Promise<T>) =>
  withoutRls("plattformpanel", fn);

/**
 * Skjuler plattformadmins som IKKE er laget av testen, for tester som trenger å styre
 * hvor mange som finnes.
 *
 * Første utkast kjørte `UPDATE users SET role='member' WHERE role='superadmin'` uten å
 * rydde opp — og degraderte den ekte kontoen i testbasen. En test skal aldri kunne endre
 * rader den ikke har opprettet selv uten å sette dem tilbake.
 */
const gjemte: string[] = [];
async function gjemAndreAdmins() {
  const { rows } = await eier.query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'superadmin' AND id <> ALL($1::text[])",
    [ryddBruker],
  );
  for (const r of rows) {
    gjemte.push(r.id);
    await eier.query("UPDATE users SET role = 'member' WHERE id = $1", [r.id]);
  }
}

const feilFra = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    throw new Error("forventet en feil");
  } catch (e) {
    return e as ApiFeil;
  }
};

describe("startSupport", () => {
  it("logger begrunnelse, navn og utløpstid", async () => {
    const orgId = await nyOrg();
    const admin = await nyAdmin("Kari Support");
    const rad = await i((db) =>
      startSupport(db, admin, { orgId, reason: "Kunden ringte om manglende avvik" }),
    );

    expect(rad.reason).toBe("Kunden ringte om manglende avvik");
    // Navnet er KOPIERT, ikke en peker: loggen skal overleve at brukeren slettes.
    expect(rad.adminName).toBe("Kari Support");
    expect(rad.endedAt).toBeNull();

    const timer = (new Date(rad.expiresAt!).getTime() - Date.now()) / 3_600_000;
    expect(timer).toBeGreaterThan(SUPPORT_SESJON_MAKS_TIMER - 1);
    expect(timer).toBeLessThanOrEqual(SUPPORT_SESJON_MAKS_TIMER);
  });

  it("overlever at plattformbrukeren slettes", async () => {
    const orgId = await nyOrg();
    const admin = await nyAdmin("Slettes Snart");
    await i((db) => startSupport(db, admin, { orgId, reason: "Feilsøking" }));

    await eier.query("UPDATE support_access_log SET superadmin_id = NULL WHERE org_id = $1", [orgId]);
    const { rows } = await eier.query<{ admin_name: string; reason: string }>(
      "SELECT admin_name, reason FROM support_access_log WHERE org_id = $1",
      [orgId],
    );
    // En innsynslogg som forsvinner sammen med den som gjorde innsynet, er ingen logg.
    expect(rows[0]!.admin_name).toBe("Slettes Snart");
    expect(rows[0]!.reason).toBe("Feilsøking");
  });

  it("avviser en ukjent organisasjon", async () => {
    const admin = await nyAdmin();
    const feil = await feilFra(() =>
      i((db) => startSupport(db, admin, { orgId: randomUUID(), reason: "Prøver seg" })),
    );
    expect(feil.status).toBe(404);
  });

  it("lager en NY rad per start, ikke gjenbruk", async () => {
    // To ulike ærend samme dag er to innsyn, ikke ett.
    const orgId = await nyOrg();
    const admin = await nyAdmin();
    await i((db) => startSupport(db, admin, { orgId, reason: "Første sak" }));
    await i((db) => startSupport(db, admin, { orgId, reason: "Andre sak" }));
    const { rows } = await eier.query("SELECT id FROM support_access_log WHERE org_id = $1", [orgId]);
    expect(rows).toHaveLength(2);
  });
});

describe("avsluttSupport", () => {
  it("avslutter egen sesjon", async () => {
    const orgId = await nyOrg();
    const admin = await nyAdmin();
    await i((db) => startSupport(db, admin, { orgId, reason: "Feilsøking" }));

    expect((await i((db) => avsluttSupport(db, admin.id, orgId))).avsluttet).toBe(1);
    const { rows } = await eier.query<{ ended_at: Date | null }>(
      "SELECT ended_at FROM support_access_log WHERE org_id = $1",
      [orgId],
    );
    expect(rows[0]!.ended_at).not.toBeNull();
  });

  it("rører IKKE en kollegas pågående innsyn", async () => {
    // Ellers kunne en plattformadmin lukket en annens sesjon og gjort loggen misvisende om
    // hvor lenge innsynet faktisk varte.
    const orgId = await nyOrg();
    const meg = await nyAdmin("Meg");
    const kollega = await nyAdmin("Kollega");
    await i((db) => startSupport(db, kollega, { orgId, reason: "Kollegaens sak" }));

    const feil = await feilFra(() => i((db) => avsluttSupport(db, meg.id, orgId)));
    expect(feil.status).toBe(400);

    const { rows } = await eier.query<{ ended_at: Date | null }>(
      "SELECT ended_at FROM support_access_log WHERE org_id = $1",
      [orgId],
    );
    expect(rows[0]!.ended_at).toBeNull();
  });
});

describe("kundeoversikten", () => {
  it("markerer kunder med aktivt innsyn", async () => {
    // Aktivt innsyn må være synlig i OVERSIKTEN. En glemt sesjon man må klikke seg inn for
    // å oppdage, er en glemt sesjon.
    const orgId = await nyOrg("Med innsyn");
    const admin = await nyAdmin();
    await i((db) => startSupport(db, admin, { orgId, reason: "Pågår" }));

    const kunder = await i((db) => hentKunder(db));
    expect(kunder.find((k) => k.id === orgId)?.harAktivSupport).toBe(true);
  });

  it("markerer ikke en avsluttet sesjon som aktiv", async () => {
    const orgId = await nyOrg();
    const admin = await nyAdmin();
    await i((db) => startSupport(db, admin, { orgId, reason: "Ferdig" }));
    await i((db) => avsluttSupport(db, admin.id, orgId));

    const kunder = await i((db) => hentKunder(db));
    expect(kunder.find((k) => k.id === orgId)?.harAktivSupport).toBe(false);
  });

  it("viser innsynsloggen på kunden", async () => {
    const orgId = await nyOrg();
    const admin = await nyAdmin("Logget Person");
    await i((db) => startSupport(db, admin, { orgId, reason: "Synlig i panelet" }));

    const kunde = await i((db) => hentKunde(db, orgId));
    expect(kunde.sesjoner).toHaveLength(1);
    expect(kunde.sesjoner[0]!.reason).toBe("Synlig i panelet");
    expect(kunde.maksTimer).toBe(SUPPORT_SESJON_MAKS_TIMER);
  });
});


describe("plattformbrukere", () => {
  it("oppretter uten passord", async () => {
    // Ingen setter passordet for noen andre — brukeren får en engangslenke og velger selv.
    const epost = `ny-${randomUUID()}@driftiq.test`;
    const { id, nyKonto } = await i((db) =>
      opprettPlattformbruker(db, { name: "Ny Admin", email: epost }),
    );
    ryddBruker.push(id);
    expect(nyKonto).toBe(true);

    const { rows } = await eier.query<{ role: string; n: string }>(
      `SELECT u.role, (SELECT count(*) FROM account a WHERE a.user_id = u.id) AS n
       FROM users u WHERE u.id = $1`,
      [id],
    );
    expect(rows[0]!.role).toBe("superadmin");
    expect(rows[0]!.n).toBe("0");
  });

  it("hever en eksisterende konto i stedet for å lage en til", async () => {
    // To kontoer på samme adresse ville brutt innloggingen uansett — e-post er unik.
    const eksisterende = await nyAdmin();
    await eier.query("UPDATE users SET role = 'member' WHERE id = $1", [eksisterende.id]);
    const { rows: f } = await eier.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [
      eksisterende.id,
    ]);

    const { id, nyKonto } = await i((db) =>
      opprettPlattformbruker(db, { name: "Uansett", email: f[0]!.email }),
    );
    expect(nyKonto).toBe(false);
    expect(id).toBe(eksisterende.id);

    const { rows } = await eier.query<{ role: string }>("SELECT role FROM users WHERE id = $1", [id]);
    expect(rows[0]!.role).toBe("superadmin");
  });

  it("hindrer at du endrer din EGEN rolle eller aktivstatus", async () => {
    // Hindrer utestenging, og gjør loggen entydig: en rolleendring er alltid noe én person
    // gjorde med en ANNEN.
    const meg = await nyAdmin();
    await nyAdmin(); // så sperren for «siste admin» ikke er den som slår inn

    const rolle = await feilFra(() => i((db) => endrePlattformbruker(db, meg.id, meg.id, { role: "member" })));
    expect(rolle.status).toBe(400);
    expect(rolle.message).toMatch(/din egen/i);

    const aktiv = await feilFra(() => i((db) => endrePlattformbruker(db, meg.id, meg.id, { active: false })));
    expect(aktiv.status).toBe(400);
  });

  it("lar deg endre ditt eget NAVN", async () => {
    // Navnet er ikke tilgang. Sperren gjelder rolle og aktivstatus, ikke alt.
    const meg = await nyAdmin();
    const endret = await i((db) => endrePlattformbruker(db, meg.id, meg.id, { name: "Nytt Navn" }));
    expect(endret.name).toBe("Nytt Navn");
  });

  it("nekter å fjerne den SISTE aktive plattformadminen", async () => {
    // Uten den finnes ingen vei inn i panelet igjen, og ingen kan starte en support-sesjon
    // for å rette det opp.
    await gjemAndreAdmins();
    const eneste = await nyAdmin();
    const annen = await nyAdmin();
    await eier.query("UPDATE users SET role = 'member' WHERE id = $1", [annen.id]);

    const feil = await feilFra(() =>
      i((db) => endrePlattformbruker(db, annen.id, eneste.id, { role: "member" })),
    );
    expect(feil.status).toBe(400);
    expect(feil.message).toMatch(/minst én aktiv/i);
  });

  it("lister bare plattformadmins, med kundemedlemskapene deres", async () => {
    await gjemAndreAdmins();
    const admin = await nyAdmin("Med Medlemskap");
    const orgId = await nyOrg("Kundelaget");
    await eier.query(
      "INSERT INTO user_org_memberships (id, user_id, org_id, role) VALUES ($1,$2,$3,'orgadmin')",
      [randomUUID(), admin.id, orgId],
    );

    const liste = await i((db) => hentPlattformbrukere(db));
    expect(liste).toHaveLength(1);
    // Medlemskapet vises fordi gaten IGNORERER det — det gir en falsk trygghet om at
    // personen «har tilgang til» laget sitt.
    expect(liste[0]!.kundemedlemskap).toEqual(["Kundelaget"]);
  });
});
