/**
 * AI-rådgiveren — verktøyisolasjon og samtaleprivatliv.
 *
 * Dette er den mest sikkerhetskritiske testfila etter `rls.test.ts`. Verktøyene leser på
 * tvers av HELE datamodellen, og en glipp her ville eksponert en annen kundes avvik,
 * kontrakter eller vernerunder til en språkmodell — og videre til den som stilte spørsmålet.
 *
 * Port av v1s `test_ai_tools_org_isolation.py` og `test_ai_samtale_isolasjon.py`.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import {
  MAKS_RADER,
  VERKTOY,
  kjorVerktoy,
  verktoyskjemaer,
} from "../src/lib/ai-verktoy";
import {
  hentForbruk,
  hentSamtale,
  hentSamtaler,
  kostnadNok,
  lagTittel,
  leggTilMelding,
  opprettSamtale,
  registrerForbruk,
  slettSamtale,
} from "../src/lib/ai";

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
  for (const id of ryddOrg.splice(0)) {
    await eier.query("DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM ai_conversations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM ai_usage_daily WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM safety_round_items WHERE round_id IN (SELECT id FROM safety_rounds WHERE org_id = $1)", [id]);
    await eier.query("DELETE FROM safety_rounds WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM deviations WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM contracts WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM documents WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM building_elements WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM hazards WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM tasks WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM user_org_memberships WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  for (const id of ryddBruker.splice(0)) await eier.query("DELETE FROM users WHERE id = $1", [id]);
});

/**
 * En org med én rad i hver tabell verktøyene leser, merket med orgens navn.
 *
 * Merket må være DISTINKT nok til at et treff i den serialiserte responsen betyr en reell
 * lekkasje. Et enkeltbokstavs merke som «b» treffer overalt i JSON og gjør testen ubrukelig
 * — den ble rød på sitt eget merke første gang.
 */
async function orgMedData(merke: string) {
  const orgId = `ai-${merke}-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId, `Laget ${merke}`, orgId,
  ]);
  ryddOrg.push(orgId);

  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,$3,true)", [
    vendorId, orgId, `Leverandør ${merke}`,
  ]);
  await eier.query(
    "INSERT INTO tasks (id, org_id, vendor_id, title, frequency, qr_token, start_date) VALUES ($1,$2,$3,$4,'annual',$5,'2020-01-01')",
    [randomUUID(), orgId, vendorId, `Oppgave ${merke}`, randomUUID()],
  );
  await eier.query(
    "INSERT INTO contracts (id, org_id, vendor_id, title, ai_readable) VALUES ($1,$2,$3,$4,false)",
    [randomUUID(), orgId, vendorId, `Avtale ${merke}`],
  );
  await eier.query(
    "INSERT INTO deviations (id, org_id, number, title, status, reported_by) VALUES ($1,$2,1,$3,'ny','test')",
    [randomUUID(), orgId, `Avvik ${merke}`],
  );
  await eier.query(
    "INSERT INTO documents (id, org_id, folder, title, filename, original_name, content_type, uploaded_by, ai_readable) VALUES ($1,$2,'annet',$3,'f.pdf','f.pdf','application/pdf','test',false)",
    [randomUUID(), orgId, `Dokument ${merke}`],
  );
  await eier.query(
    "INSERT INTO building_elements (id, org_id, name, icon) VALUES ($1,$2,$3,'🏗')",
    [randomUUID(), orgId, `Bygningsdel ${merke}`],
  );
  await eier.query(
    "INSERT INTO hazards (id, org_id, title, probability, consequence, status) VALUES ($1,$2,$3,3,3,'open')",
    [randomUUID(), orgId, `Fare ${merke}`],
  );
  const roundId = randomUUID();
  await eier.query("INSERT INTO safety_rounds (id, org_id, title, status) VALUES ($1,$2,$3,'planned')", [
    roundId, orgId, `Runde ${merke}`,
  ]);
  await eier.query(
    "INSERT INTO safety_round_items (id, round_id, text, checked) VALUES ($1,$2,$3,true)",
    [randomUUID(), roundId, `Punkt ${merke}`],
  );

  return { orgId, merke };
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
  ryddBruker.push(id);
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

// ---------------------------------------------------------------------------------------

describe("verktøyskjemaene", () => {
  it("eksponerer INGEN org-parameter", () => {
    // Hadde de gjort det, kunne en promptinjeksjon i et avviksnotat eller et
    // kontraktvedlegg fått modellen til å be om en annen kundes data.
    for (const v of verktoyskjemaer()) {
      const felter = Object.keys(v.input_schema.properties ?? {});
      const mistenkelige = felter.filter((f) => /org/i.test(f));
      expect(mistenkelige, `${v.name} eksponerer ${mistenkelige}`).toEqual([]);
    }
  });

  it("har et skjema for hvert registrert verktøy", () => {
    expect(verktoyskjemaer().map((v) => v.name).sort()).toEqual(VERKTOY.map((v) => v.navn).sort());
  });

  it("avviser et ukjent verktøynavn i stedet for å kaste", async () => {
    const { orgId } = await orgMedData("XRAY");
    const svar = (await i(orgId, (db) => kjorVerktoy(db, orgId, "slett_alt", {}))) as { feil?: string };
    expect(svar.feil).toMatch(/ukjent verktøy/i);
  });
});

describe("org-isolasjon i hvert verktøy", () => {
  /**
   * Kjører hvert lesende verktøy i org A og krever at ingenting fra org B lekker. Hver rad i
   * B er merket med B-ens navn, så en lekkasje synes i den serialiserte responsen.
   */
  it("lekker ikke data fra en annen org", async () => {
    const a = await orgMedData("ALFA");
    const b = await orgMedData("BRAVO");

    const lesende: Array<[string, Record<string, unknown>]> = [
      ["hent_kontrakter", {}],
      ["hent_avvik", {}],
      ["hent_internkontroll_status", {}],
      ["hent_oppgaver", {}],
      ["hent_vedlikeholdsplan", {}],
      ["hent_dokumentliste", {}],
      ["hent_statistikk", { datasett: "vernerunde_punkter" }],
      ["hent_statistikk", { datasett: "avvik_per_status" }],
      ["hent_statistikk", { datasett: "oppgaver_forsinket" }],
    ];

    for (const [navn, args] of lesende) {
      const svar = await i(a.orgId, (db) => kjorVerktoy(db, a.orgId, navn, args));
      const json = JSON.stringify(svar);
      expect(json, `${navn} lekket data fra org B`).not.toContain(b.merke);
    }
  });

  it("ser sin EGEN org sine data", async () => {
    // Motstykket: en policy som er for streng er like ødeleggende som en som lekker.
    const a = await orgMedData("egen");
    const svar = await i(a.orgId, (db) => kjorVerktoy(db, a.orgId, "hent_avvik", {}));
    expect(JSON.stringify(svar)).toContain("Avvik egen");
  });

  it("joiner seg fram til org for tabeller uten egen org_id", async () => {
    // `safety_round_items` har ingen org_id. Uten joinen mot `safety_rounds` ville
    // statistikken telt sjekkpunkter på tvers av alle kunder.
    const a = await orgMedData("JOINALFA");
    await orgMedData("JOINBRAVO");

    const svar = (await i(a.orgId, (db) =>
      kjorVerktoy(db, a.orgId, "hent_statistikk", { datasett: "vernerunde_punkter" }),
    )) as { avhuket: number };
    expect(svar.avhuket, "Telte sjekkpunkter fra en annen org").toBe(1);
  });

  it("gir 'finnes ikke' på en id fra en annen org", async () => {
    const a = await orgMedData("IDALFA");
    const b = await orgMedData("IDBRAVO");
    const { rows } = await eier.query<{ id: string }>("SELECT id FROM contracts WHERE org_id = $1", [b.orgId]);

    const svar = (await i(a.orgId, (db) =>
      kjorVerktoy(db, a.orgId, "hent_kontraktdokument", { kontraktId: rows[0]!.id }),
    )) as { feil?: string };
    expect(svar.feil).toMatch(/finnes ikke/i);
  });

  it("modellen kan ikke overstyre org via argumentene", async () => {
    // Selv om modellen sender med orgId/org_id, leses den aldri derfra — den kommer som
    // eget argument fra rutelaget.
    const a = await orgMedData("STYRT");
    const b = await orgMedData("KAPRET");

    const svar = await i(a.orgId, (db) =>
      kjorVerktoy(db, a.orgId, "hent_avvik", { orgId: b.orgId, org_id: b.orgId }),
    );
    expect(JSON.stringify(svar)).not.toContain(b.merke);
  });
});

describe("opt-in på dokumentinnhold", () => {
  it("nekter å lese en kontrakt som ikke er delt", async () => {
    // Kundens eget valg per avtale: dokumentet kan inneholde kommersielle vilkår de ikke
    // vil sende til Anthropics API. Den som ikke har tatt stilling, deler ingenting.
    const { orgId } = await orgMedData("opt");
    const { rows } = await eier.query<{ id: string }>("SELECT id FROM contracts WHERE org_id = $1", [orgId]);

    const svar = (await i(orgId, (db) =>
      kjorVerktoy(db, orgId, "hent_kontraktdokument", { kontraktId: rows[0]!.id }),
    )) as { feil?: string };
    expect(svar.feil).toMatch(/ikke delt med AI-rådgiveren/i);
  });

  it("nekter å lese et dokument som ikke er delt", async () => {
    const { orgId } = await orgMedData("optdok");
    const { rows } = await eier.query<{ id: string }>("SELECT id FROM documents WHERE org_id = $1", [orgId]);

    const svar = (await i(orgId, (db) =>
      kjorVerktoy(db, orgId, "hent_dokument", { dokumentId: rows[0]!.id }),
    )) as { feil?: string };
    expect(svar.feil).toMatch(/ikke delt med AI-rådgiveren/i);
  });

  it("viser i listen HVILKE dokumenter som er delt", async () => {
    const { orgId } = await orgMedData("liste");
    const svar = (await i(orgId, (db) => kjorVerktoy(db, orgId, "hent_dokumentliste", {}))) as {
      dokumenter: Array<{ lesbart: boolean }>;
    };
    expect(svar.dokumenter[0]!.lesbart).toBe(false);
  });
});

describe("avkorting", () => {
  it("flagger når listen er kuttet", async () => {
    // Modellen skal kunne si fra i stedet for å konkludere på et ufullstendig grunnlag.
    const { orgId } = await orgMedData("mange");
    const verdier = Array.from({ length: MAKS_RADER + 5 }, (_, n) =>
      `('${randomUUID()}','${orgId}',${n + 10},'Avvik ${n}','ny','test')`,
    ).join(",");
    await eier.query(
      `INSERT INTO deviations (id, org_id, number, title, status, reported_by) VALUES ${verdier}`,
    );

    const svar = (await i(orgId, (db) => kjorVerktoy(db, orgId, "hent_avvik", {}))) as {
      avkortet: boolean;
      avvik: unknown[];
    };
    expect(svar.avkortet).toBe(true);
    expect(svar.avvik).toHaveLength(MAKS_RADER);
  });
});

describe("samtaler er private per bruker", () => {
  it("lar eieren lese sin egen samtale", async () => {
    const { orgId } = await orgMedData("s1");
    const bruker = await nyBruker(orgId, "Kari");
    const s = await i(orgId, (db) => opprettSamtale(db, orgId, bruker, "Hva koster heisservice?"));
    expect((await i(orgId, (db) => hentSamtale(db, orgId, bruker, s.id))).title).toContain("heisservice");
  });

  it("lar IKKE en kollega i samme org lese den", async () => {
    // org_id alene ville latt et styremedlem lese kollegenes samtaler.
    const { orgId } = await orgMedData("s2");
    const kari = await nyBruker(orgId, "Kari");
    const ola = await nyBruker(orgId, "Ola");
    const s = await i(orgId, (db) => opprettSamtale(db, orgId, kari, "Privat spørsmål"));

    expect((await feilFra(() => i(orgId, (db) => hentSamtale(db, orgId, ola, s.id)))).status).toBe(404);
  });

  it("lar ikke samme bruker-id lese den fra en annen org", async () => {
    const a = await orgMedData("s3a");
    const b = await orgMedData("s3b");
    const bruker = await nyBruker(a.orgId, "Kari");
    const s = await i(a.orgId, (db) => opprettSamtale(db, a.orgId, bruker, "Vårt"));

    expect((await feilFra(() => i(b.orgId, (db) => hentSamtale(db, b.orgId, bruker, s.id)))).status).toBe(404);
  });

  it("lister bare egne samtaler", async () => {
    const { orgId } = await orgMedData("s4");
    const kari = await nyBruker(orgId, "Kari");
    const ola = await nyBruker(orgId, "Ola");
    await i(orgId, (db) => opprettSamtale(db, orgId, kari, "Kari sitt"));
    await i(orgId, (db) => opprettSamtale(db, orgId, ola, "Ola sitt"));

    const kariSine = await i(orgId, (db) => hentSamtaler(db, orgId, kari));
    expect(kariSine.map((s) => s.title)).toEqual(["Kari sitt"]);
  });

  it("tar med meldingene ved sletting", async () => {
    const { orgId } = await orgMedData("s5");
    const bruker = await nyBruker(orgId, "Kari");
    const s = await i(orgId, (db) => opprettSamtale(db, orgId, bruker, "Spørsmål"));
    await i(orgId, (db) => leggTilMelding(db, s.id, "bruker", "Hei"));

    await i(orgId, (db) => slettSamtale(db, orgId, bruker, s.id));
    const { rows } = await eier.query("SELECT 1 FROM ai_messages WHERE conversation_id = $1", [s.id]);
    expect(rows).toHaveLength(0);
  });

  it("kutter en lang tittel i stedet for å lagre hele spørsmålet", () => {
    expect(lagTittel("a".repeat(200))).toHaveLength(58);
    expect(lagTittel("  Kort   spørsmål  ")).toBe("Kort spørsmål");
  });
});

describe("forbruk", () => {
  it("summerer på samme dag i stedet for å lage nye rader", async () => {
    const { orgId } = await orgMedData("f1");
    const bruk = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, apiKall: 2 };
    await i(orgId, (db) => registrerForbruk(db, orgId, bruk));
    await i(orgId, (db) => registrerForbruk(db, orgId, bruk));

    const f = await i(orgId, (db) => hentForbruk(db, orgId));
    expect(f.dager).toHaveLength(1);
    expect(f.sum.inputTokens).toBe(200);
    expect(f.sum.sporsmal).toBe(2);
    expect(f.sum.apiKall).toBe(4);
  });

  it("inneholder ingen spørsmål, svar eller bruker-id", async () => {
    // Tabellen leses av plattformpanelet og overlever at samtalene slettes. Da må den være
    // fri for personopplysninger.
    const { rows } = await eier.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_daily'",
    );
    const kolonner = rows.map((r) => r.column_name);
    expect(kolonner).not.toContain("user_id");
    expect(kolonner.filter((k) => /content|question_text|prompt|melding/.test(k))).toEqual([]);
  });

  it("regner ut kostnad med introduksjonspris før utløp", () => {
    const bruk = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // 2 USD/Mtok i introduksjonsperioden, 3 etterpå.
    expect(kostnadNok(bruk, "claude-sonnet-5", "2026-08-01")).toBeCloseTo(2 * 11, 1);
    expect(kostnadNok(bruk, "claude-sonnet-5", "2026-09-01")).toBeCloseTo(3 * 11, 1);
  });

  it("priser cache-lesing lavere enn vanlig input", () => {
    const les = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    const inn = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(kostnadNok(les)).toBeLessThan(kostnadNok(inn));
  });
});
