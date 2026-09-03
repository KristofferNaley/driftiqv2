/**
 * Økonomimodulen — ingen v1-forgjenger (v1 hadde ingen økonomi). Tyngdepunktet er
 * reglene som ikke kan leses ut av skjemaet: satsberegningen, at eierskifte arkiverer i
 * stedet for å slette, at vedtatt budsjett er låst, at en beregning ikke rører en manuell
 * sats, at en kjøring ikke kan dobles, og at fakturastatus bare kan gå de lovlige veiene.
 * Pluss krysstesten: org A ser aldri org Bs eiere, budsjett eller fakturaer.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import type { Aktor } from "../src/lib/aktor";
import {
  annullerKjoring,
  avvisFaktura,
  beregnSatser,
  eksporterKjoring,
  endreLinje,
  gjenapneFaktura,
  godkjennFaktura,
  hentBudsjett,
  hentEiere,
  hentEierhistorikk,
  hentFaktura,
  hentFakturaer,
  hentKjoring,
  hentOkonomioversikt,
  hentSatser,
  leggTilLinje,
  markerBetalt,
  opprettBudsjett,
  opprettKjoring,
  registrerEier,
  registrerFaktura,
  settBrok,
  settSats,
  slettEier,
  slettFaktura,
  vedtaBudsjett,
} from "../src/lib/okonomi";
import {
  andelAvAaret,
  beregnSats,
  brokSum,
  brokStemmer,
  budsjettSummer,
  kroner,
  manederI,
  tilCsv,
  tilOre,
} from "../src/lib/okonomiregler";

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
    // FK-riktig rekkefølge. Alle økonomitabellene har egen org_id.
    await eier.query("DELETE FROM fee_run_lines WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM fee_runs WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM supplier_invoices WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM unit_fee_rates WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM budget_lines WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM budgets WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM unit_owners WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM units WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

const aktor: Aktor = { navn: "Test Testesen", brukerId: null };

/** Org med tre seksjoner (brøk 1/4, 1/4, 1/2) og én leverandør. */
async function oppsett() {
  const orgId = `oko-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [
    orgId, "Økonomilaget", orgId,
  ]);
  ryddOrg.push(orgId);
  const enheter: string[] = [];
  for (const [nr, teller] of [["1", 1], ["2", 1], ["3", 2]] as const) {
    const id = randomUUID();
    await eier.query(
      "INSERT INTO units (id, org_id, type, andelsnr, leilighetsnr, brok_teller, brok_nevner) VALUES ($1,$2,'bolig',$3,$4,$5,4)",
      [id, orgId, nr, `H010${nr}`, teller],
    );
    enheter.push(id);
  }
  // Et fellesareal skal aldri dukke opp i eierregisteret eller få sats.
  await eier.query("INSERT INTO units (id, org_id, type, navn) VALUES ($1,$2,'fellesareal','Bossrom')", [randomUUID(), orgId]);
  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Demo Rør AS',true)", [vendorId, orgId]);
  return { orgId, enheter, vendorId };
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

/** Vedtatt budsjett med felleskostnader 120 000 kr (12 000 000 øre) → 10 000 kr/mnd samlet. */
async function vedtattBudsjett(orgId: string, aar = new Date().getFullYear()) {
  const b = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: aar }));
  const fk = b.linjer.find((l) => l.kind === "felleskost")!;
  await i(orgId, (db) => endreLinje(db, orgId, b.id, fk.id, { amount: 12_000_000 }));
  return i(orgId, (db) => vedtaBudsjett(db, orgId, b.id, aktor, { adoptedDate: `${aar}-03-15` }));
}

// ---------------------------------------------------------------------------------------
// Rene regler
// ---------------------------------------------------------------------------------------

describe("okonomiregler", () => {
  it("regner sats som felleskost × brøk / 12, rundet til hele kroner", () => {
    // 120 000 kr × 1/4 / 12 = 2 500 kr.
    expect(beregnSats(12_000_000, 1, 4)).toBe(250_000);
    // 100 000 kr × 1/3 / 12 = 2 777,78 → 2 778 kr, ikke 2 777,78.
    expect(beregnSats(10_000_000, 1, 3)).toBe(277_800);
    expect(() => beregnSats(1, 1, 0)).toThrow();
  });

  it("konverterer det brukeren skriver til øre, og tilbake", () => {
    expect(tilOre("3 500")).toBe(350_000);
    expect(tilOre("3500,50")).toBe(350_050);
    expect(tilOre("3.500,50")).toBe(350_050);
    expect(tilOre("3500.5")).toBe(350_050);
    expect(tilOre("12 kr")).toBe(1_200);
    expect(tilOre("abc")).toBeNull();
    expect(tilOre("")).toBeNull();
    // `toLocaleString("nb-NO")` bruker et ikke-brytende mellomrom som tusenskille — normaliseres
    // her, så testen ikke avhenger av hvilken ICU-versjon Node er bygget med.
    const vanlig = (t: string) => t.replace(/\s/g, " ");
    expect(vanlig(kroner(350_000))).toBe("3 500 kr");
    expect(vanlig(kroner(572_550))).toBe("5 725,50 kr");
    expect(vanlig(kroner(-100))).toBe("−1 kr");
  });

  it("summerer brøker og godtar avrunding innenfor toleransen", () => {
    expect(brokSum([{ teller: 1, nevner: 4 }, { teller: 1, nevner: 4 }, { teller: 2, nevner: 4 }])).toBe(1);
    expect(brokStemmer(0.999)).toBe(true);
    expect(brokStemmer(0.9)).toBe(false);
    // Uten brøk telles ikke — og ødelegger ikke summen.
    expect(brokSum([{ teller: null, nevner: null }, { teller: 1, nevner: 2 }])).toBe(0.5);
  });

  it("summerer budsjettet per type", () => {
    const s = budsjettSummer([
      { kind: "felleskost", amount: 100 },
      { kind: "inntekt", amount: 20 },
      { kind: "kostnad", amount: 110 },
    ]);
    expect(s).toEqual({ felleskost: 100, inntekter: 20, kostnader: 110, resultat: 10 });
  });

  it("lister månedene i et halvår og andelen av året", () => {
    expect(manederI("2026-07-01", "2026-12-31")).toEqual([
      "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01",
    ]);
    const sept = new Date(2026, 8, 3);
    expect(andelAvAaret(2025, sept)).toBe(1);
    expect(andelAvAaret(2027, sept)).toBe(0);
    expect(andelAvAaret(2026, sept)).toBeCloseTo(8 / 12);
  });

  it("lager CSV med semikolon, BOM og anførselstegn der det trengs", () => {
    const csv = tilCsv([["a", "b;c"], [1, 'si "hei"']]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('a;"b;c"');
    expect(csv).toContain('1;"si ""hei"""');
  });
});

// ---------------------------------------------------------------------------------------
// Eierregisteret
// ---------------------------------------------------------------------------------------

describe("eierregisteret", () => {
  it("viser boligene med brøk og uten fellesarealer", async () => {
    const { orgId } = await oppsett();
    const r = await i(orgId, (db) => hentEiere(db, orgId));
    expect(r.seksjoner.length).toBe(3);
    expect(r.brokSum).toBe(1);
    expect(r.utenEier).toBe(3);
    expect(r.utenBrok).toBe(0);
  });

  it("arkiverer forrige eier ved eierskifte i stedet for å slette", async () => {
    const { orgId, enheter } = await oppsett();
    const forste = await i(orgId, (db) =>
      registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Kari", ownerFrom: "2020-01-01" }),
    );
    await i(orgId, (db) =>
      registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Ola", ownerFrom: "2026-09-01" }),
    );

    const hist = await i(orgId, (db) => hentEierhistorikk(db, orgId, enheter[0]!));
    expect(hist.map((e) => e.name)).toEqual(["Ola", "Kari"]);
    expect(hist.find((e) => e.id === forste.id)!.ownerTo).toBe("2026-08-31");

    const r = await i(orgId, (db) => hentEiere(db, orgId));
    expect(r.seksjoner.find((s) => s.unitId === enheter[0])!.eier?.name).toBe("Ola");
  });

  it("avviser eierskifte datert før nåværende eiers start", async () => {
    const { orgId, enheter } = await oppsett();
    await i(orgId, (db) =>
      registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Kari", ownerFrom: "2026-01-01" }),
    );
    const feil = await feilFra(() =>
      i(orgId, (db) => registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Ola", ownerFrom: "2025-01-01" })),
    );
    expect(feil.status).toBe(400);
  });

  it("gjenåpner forrige eier når nåværende slettes som feilregistrering", async () => {
    const { orgId, enheter } = await oppsett();
    await i(orgId, (db) =>
      registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Kari", ownerFrom: "2020-01-01" }),
    );
    const feil = await i(orgId, (db) =>
      registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Feil", ownerFrom: "2026-09-01" }),
    );
    await i(orgId, (db) => slettEier(db, orgId, feil.id, aktor));

    const hist = await i(orgId, (db) => hentEierhistorikk(db, orgId, enheter[0]!));
    expect(hist.length).toBe(1);
    expect(hist[0]!.ownerTo).toBeNull();
  });

  it("nekter eier og brøk på fellesareal, og halv brøk", async () => {
    const { orgId } = await oppsett();
    const felles = await eier.query("SELECT id FROM units WHERE org_id = $1 AND type = 'fellesareal'", [orgId]);
    const fellesId = felles.rows[0].id as string;
    expect((await feilFra(() => i(orgId, (db) => registrerEier(db, orgId, aktor, { unitId: fellesId, name: "X", ownerFrom: "2026-01-01" })))).status).toBe(400);
    expect((await feilFra(() => i(orgId, (db) => settBrok(db, orgId, fellesId, { teller: 1, nevner: 4 })))).status).toBe(400);
    const bolig = (await eier.query("SELECT id FROM units WHERE org_id = $1 AND type = 'bolig' LIMIT 1", [orgId])).rows[0].id as string;
    expect((await feilFra(() => i(orgId, (db) => settBrok(db, orgId, bolig, { teller: 1, nevner: null })))).status).toBe(400);
  });

  it("ser ikke en annen orgs eiere eller seksjoner", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const feil = await feilFra(() =>
      i(a.orgId, (db) => registrerEier(db, a.orgId, aktor, { unitId: b.enheter[0]!, name: "X", ownerFrom: "2026-01-01" })),
    );
    expect(feil.status).toBe(404);
    await i(b.orgId, (db) => registrerEier(db, b.orgId, aktor, { unitId: b.enheter[0]!, name: "Bs eier", ownerFrom: "2026-01-01" }));
    const iA = await i(a.orgId, (db) => hentEiere(db, a.orgId));
    expect(iA.seksjoner.every((s) => s.eier === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// Budsjett og satser
// ---------------------------------------------------------------------------------------

describe("budsjett", () => {
  it("starter med standardlinjene og ett budsjett per år", async () => {
    const { orgId } = await oppsett();
    const b = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: 2027 }));
    expect(b.linjer.length).toBeGreaterThan(5);
    expect(b.linjer.some((l) => l.kind === "felleskost" && l.accountFrom === 3601)).toBe(true);
    const feil = await feilFra(() => i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: 2027 })));
    expect(feil.status).toBe(400);
  });

  it("kopierer linjene fra et annet budsjett", async () => {
    const { orgId } = await oppsett();
    const a = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: 2026 }));
    await i(orgId, (db) => leggTilLinje(db, orgId, a.id, { kind: "kostnad", name: "Heis", accountFrom: 6620, amount: 5_000_000 }));
    const b = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: 2027, kopierFraId: a.id }));
    expect(b.linjer.find((l) => l.name === "Heis")?.amount).toBe(5_000_000);
  });

  it("låser linjene etter vedtak, og krever felleskostnader over null", async () => {
    const { orgId } = await oppsett();
    const b = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: 2027 }));
    const utenBelop = await feilFra(() => i(orgId, (db) => vedtaBudsjett(db, orgId, b.id, aktor, { adoptedDate: "2027-03-01" })));
    expect(utenBelop.message).toMatch(/felleskostnad/i);

    const fk = b.linjer.find((l) => l.kind === "felleskost")!;
    await i(orgId, (db) => endreLinje(db, orgId, b.id, fk.id, { amount: 12_000_000 }));
    const vedtatt = await i(orgId, (db) => vedtaBudsjett(db, orgId, b.id, aktor, { adoptedDate: "2027-03-01" }));
    expect(vedtatt.status).toBe("vedtatt");
    expect(vedtatt.adoptedDate).toBe("2027-03-01");
    const laast = await feilFra(() =>
      i(orgId, (db) => leggTilLinje(db, orgId, vedtatt.id, { kind: "kostnad", name: "X", amount: 1 })),
    );
    expect(laast.status).toBe(409);
  });

  it("beregner sats per seksjon fra vedtatt budsjett og brøk", async () => {
    const { orgId, enheter } = await oppsett();
    const b = await vedtattBudsjett(orgId, 2027);
    const r = await i(orgId, (db) => beregnSatser(db, orgId, b.id, aktor));
    expect(r).toMatchObject({ beregnet: 3, overstyrt: 0, utenBrok: 0, validFrom: "2027-01-01" });

    const s = await i(orgId, (db) => hentSatser(db, orgId, "2027-01-01"));
    const per = Object.fromEntries(s.rader.map((x) => [x.unitId, x.sats?.monthlyAmount]));
    expect(per[enheter[0]!]).toBe(250_000);
    expect(per[enheter[2]!]).toBe(500_000);
    expect(s.maanedligSum).toBe(1_000_000);
    // Før gyldig-fra finnes ingen sats.
    expect((await i(orgId, (db) => hentSatser(db, orgId, "2026-12-31"))).utenSats).toBe(3);
  });

  it("rører ikke en manuell sats ved ny beregning, og teller seksjoner uten brøk", async () => {
    const { orgId, enheter } = await oppsett();
    const b = await vedtattBudsjett(orgId, 2027);
    await i(orgId, (db) => settSats(db, orgId, enheter[0]!, aktor, { monthlyAmount: 300_000, validFrom: "2027-01-01", note: "garasje" }));
    await i(orgId, (db) => settBrok(db, orgId, enheter[1]!, { teller: null, nevner: null }));

    const r = await i(orgId, (db) => beregnSatser(db, orgId, b.id, aktor));
    expect(r).toMatchObject({ beregnet: 1, overstyrt: 1, utenBrok: 1 });
    const s = await i(orgId, (db) => hentSatser(db, orgId, "2027-01-01"));
    expect(s.rader.find((x) => x.unitId === enheter[0])!.sats?.monthlyAmount).toBe(300_000);
    expect(s.rader.find((x) => x.unitId === enheter[1])!.sats).toBeNull();
  });

  it("nekter satsberegning fra et utkast", async () => {
    const { orgId } = await oppsett();
    const b = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: 2027 }));
    expect((await feilFra(() => i(orgId, (db) => beregnSatser(db, orgId, b.id, aktor)))).status).toBe(409);
  });

  it("ser ikke en annen orgs budsjett", async () => {
    const a = await oppsett();
    const b = await oppsett();
    const iB = await i(b.orgId, (db) => opprettBudsjett(db, b.orgId, aktor, { year: 2027 }));
    expect((await feilFra(() => i(a.orgId, (db) => hentBudsjett(db, a.orgId, iB.id)))).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------
// Halvårskjøringer
// ---------------------------------------------------------------------------------------

describe("halvårskjøring", () => {
  it("lager én linje per seksjon per måned med riktig eier, forfall og referanse", async () => {
    const { orgId, enheter } = await oppsett();
    const b = await vedtattBudsjett(orgId, 2027);
    await i(orgId, (db) => beregnSatser(db, orgId, b.id, aktor));
    await i(orgId, (db) => registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Kari", ownerFrom: "2020-01-01" }));
    // Eierskifte 1. mars: januar og februar til Kari, resten til Ola.
    await i(orgId, (db) => registrerEier(db, orgId, aktor, { unitId: enheter[0]!, name: "Ola", ownerFrom: "2027-03-01" }));

    const k = await i(orgId, (db) => opprettKjoring(db, orgId, aktor, { periodStart: "2027-01-01", dueDay: 15 }));
    expect(k.lineCount).toBe(18);
    expect(k.totalAmount).toBe(6_000_000);
    expect(k.missingOwners).toBe(2);

    const forste = k.linjer.filter((l) => l.unitId === enheter[0]);
    expect(forste.map((l) => l.ownerName)).toEqual(["Kari", "Kari", "Ola", "Ola", "Ola", "Ola"]);
    expect(forste[0]!.dueDate).toBe("2027-01-15");
    expect(forste[0]!.orderReference).toBe(`${enheter[0]}:2027-01`);
  });

  it("nekter kjøring når en seksjon mangler sats, og når perioden alt er kjørt", async () => {
    const { orgId, enheter } = await oppsett();
    const utenSats = await feilFra(() => i(orgId, (db) => opprettKjoring(db, orgId, aktor, { periodStart: "2027-07-01", dueDay: 15 })));
    expect(utenSats.message).toMatch(/mangler sats/);

    for (const u of enheter) {
      await i(orgId, (db) => settSats(db, orgId, u, aktor, { monthlyAmount: 100_000, validFrom: "2027-01-01" }));
    }
    const k = await i(orgId, (db) => opprettKjoring(db, orgId, aktor, { periodStart: "2027-07-01", dueDay: 15 }));
    const dobbel = await feilFra(() => i(orgId, (db) => opprettKjoring(db, orgId, aktor, { periodStart: "2027-07-01", dueDay: 15 })));
    expect(dobbel.status).toBe(409);

    // Annullert → kan kjøres på nytt.
    await i(orgId, (db) => annullerKjoring(db, orgId, k.id, aktor));
    const ny = await i(orgId, (db) => opprettKjoring(db, orgId, aktor, { periodStart: "2027-07-01", dueDay: 20 }));
    expect(ny.linjer[0]!.dueDate).toBe("2027-07-20");

    const feilStart = await feilFra(() => i(orgId, (db) => opprettKjoring(db, orgId, aktor, { periodStart: "2027-02-01", dueDay: 15 })));
    expect(feilStart.status).toBe(400);
  });

  it("eksporterer CSV og logger eksporten", async () => {
    const { orgId, enheter } = await oppsett();
    for (const u of enheter) {
      await i(orgId, (db) => settSats(db, orgId, u, aktor, { monthlyAmount: 100_000, validFrom: "2027-01-01" }));
    }
    const k = await i(orgId, (db) => opprettKjoring(db, orgId, aktor, { periodStart: "2027-01-01", dueDay: 15 }));
    const fil = await i(orgId, (db) => eksporterKjoring(db, orgId, k.id, aktor));
    const tekst = new TextDecoder().decode(fil.innhold);
    expect(fil.navn).toBe("felleskostnader-2027-01-01-2027-06-30.csv");
    expect(tekst.split("\r\n").filter(Boolean).length).toBe(1 + 18);
    expect(tekst).toContain("1000;");

    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 AND entity = 'kjoring' ORDER BY occurred_at", [orgId]);
    expect(logg.rows.map((r) => r.event as string).some((e) => e.startsWith("Eksporterte"))).toBe(true);
  });

  it("ser ikke en annen orgs kjøring", async () => {
    const a = await oppsett();
    const b = await oppsett();
    for (const u of b.enheter) {
      await i(b.orgId, (db) => settSats(db, b.orgId, u, aktor, { monthlyAmount: 100_000, validFrom: "2027-01-01" }));
    }
    const k = await i(b.orgId, (db) => opprettKjoring(db, b.orgId, aktor, { periodStart: "2027-01-01", dueDay: 15 }));
    expect((await feilFra(() => i(a.orgId, (db) => hentKjoring(db, a.orgId, k.id)))).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------
// Fakturagodkjenning
// ---------------------------------------------------------------------------------------

describe("fakturagodkjenning", () => {
  const faktura = (vendorId: string | null, ekstra: Record<string, unknown> = {}) => ({
    vendorId,
    invoiceDate: "2026-09-01",
    dueDate: "2026-09-15",
    amount: 572_550,
    ...ekstra,
  });

  it("krever leverandør eller navn, og viser navnet fra registeret", async () => {
    const { orgId, vendorId } = await oppsett();
    expect((await feilFra(() => i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(null))))).status).toBe(400);
    const f = await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(vendorId)));
    expect(f.leverandorNavn).toBe("Demo Rør AS");
    expect(f.status).toBe("mottatt");
    const fri = await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(null, { supplierName: "Engangsfirma" })));
    expect(fri.leverandorNavn).toBe("Engangsfirma");
  });

  it("følger de lovlige overgangene og logger beslutningen", async () => {
    const { orgId, vendorId } = await oppsett();
    const f = await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(vendorId, { invoiceNumber: "1001" })));

    // mottatt → betalt er ikke lov.
    expect((await feilFra(() => i(orgId, (db) => markerBetalt(db, orgId, f.id, aktor, { paidDate: "2026-09-10" })))).status).toBe(409);

    const godkjent = await i(orgId, (db) => godkjennFaktura(db, orgId, f.id, aktor, { note: "OK iht. avtale" }));
    expect(godkjent.status).toBe("godkjent");
    expect(godkjent.decidedBy).toBe("Test Testesen");

    const betalt = await i(orgId, (db) => markerBetalt(db, orgId, f.id, aktor, { paidDate: "2026-09-10" }));
    expect(betalt.paidDate).toBe("2026-09-10");
    // betalt er endestasjon.
    expect((await feilFra(() => i(orgId, (db) => avvisFaktura(db, orgId, f.id, aktor, { note: "nei" })))).status).toBe(409);
    expect((await feilFra(() => i(orgId, (db) => slettFaktura(db, orgId, f.id, aktor)))).status).toBe(409);

    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 AND entity = 'faktura' ORDER BY occurred_at", [orgId]);
    expect(logg.rows.map((r) => r.event as string)).toEqual([
      expect.stringMatching(/^Godkjente faktura 1001 fra Demo Rør AS på 5725,50 kr — OK iht. avtale$/),
      expect.stringMatching(/^Registrerte faktura 1001 .* som betalt 2026-09-10$/),
    ]);
  });

  it("avvist kan gjenåpnes; avvisning krever begrunnelse", async () => {
    const { orgId, vendorId } = await oppsett();
    const f = await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(vendorId)));
    const avvist = await i(orgId, (db) => avvisFaktura(db, orgId, f.id, aktor, { note: "Feil beløp" }));
    expect(avvist.decisionNote).toBe("Feil beløp");
    const igjen = await i(orgId, (db) => gjenapneFaktura(db, orgId, f.id, aktor));
    expect(igjen.status).toBe("mottatt");
    expect(igjen.decidedBy).toBeNull();
  });

  it("teller godkjente og betalte fakturaer som faktisk på budsjettlinja", async () => {
    const { orgId, vendorId } = await oppsett();
    const aar = new Date().getFullYear();
    const b = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: aar }));
    const linje = b.linjer.find((l) => l.kind === "kostnad")!;
    const f1 = await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(vendorId, { budgetLineId: linje.id, amount: 100_000 })));
    await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(vendorId, { budgetLineId: linje.id, amount: 50_000 })));
    // Bare den godkjente teller.
    await i(orgId, (db) => godkjennFaktura(db, orgId, f1.id, aktor, {}));

    const etter = await i(orgId, (db) => hentBudsjett(db, orgId, b.id));
    expect(etter.linjer.find((l) => l.id === linje.id)!.faktisk).toBe(100_000);
    expect(etter.faktiskKostnader).toBe(100_000);

    const oversikt = await i(orgId, (db) => hentOkonomioversikt(db, orgId, new Date(aar, 8, 3)));
    expect(oversikt.fakturaer.tilGodkjenning).toEqual({ antall: 1, sum: 50_000 });
    expect(oversikt.budsjett?.faktiskKostnader).toBe(100_000);
  });

  it("markerer forfalte fakturaer og filtrerer på status og år", async () => {
    const { orgId, vendorId } = await oppsett();
    await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(vendorId, { dueDate: "2000-01-01" })));
    await i(orgId, (db) => registrerFaktura(db, orgId, aktor, faktura(vendorId, { invoiceDate: "2025-05-05", dueDate: "2999-01-01" })));
    const alle = await i(orgId, (db) => hentFakturaer(db, orgId));
    expect(alle.filter((f) => f.forfalt).length).toBe(1);
    expect((await i(orgId, (db) => hentFakturaer(db, orgId, { aar: 2025 }))).length).toBe(1);
    expect((await i(orgId, (db) => hentFakturaer(db, orgId, { status: "godkjent" }))).length).toBe(0);
  });

  it("avviser leverandør og budsjettlinje fra en annen org, og skjuler fakturaene", async () => {
    const a = await oppsett();
    const b = await oppsett();
    expect((await feilFra(() => i(a.orgId, (db) => registrerFaktura(db, a.orgId, aktor, faktura(b.vendorId))))).status).toBe(404);
    const iB = await i(b.orgId, (db) => opprettBudsjett(db, b.orgId, aktor, { year: 2027 }));
    expect((await feilFra(() => i(a.orgId, (db) => registrerFaktura(db, a.orgId, aktor, faktura(null, { supplierName: "X", budgetLineId: iB.linjer[0]!.id }))))).status).toBe(404);
    const fB = await i(b.orgId, (db) => registrerFaktura(db, b.orgId, aktor, faktura(b.vendorId)));
    expect((await feilFra(() => i(a.orgId, (db) => hentFaktura(db, a.orgId, fB.id)))).status).toBe(404);
    expect((await i(a.orgId, (db) => hentFakturaer(db, a.orgId))).length).toBe(0);
  });
});
