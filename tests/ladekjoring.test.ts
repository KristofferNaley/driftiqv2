/**
 * Ladekjøringer — fakturagrunnlaget for lading og sendingen til regnskapssystemet
 * (docs/easee.md «Etappe 3», docs/fiken.md «Steg 3»). Ingen v1-forgjenger.
 *
 * Tyngdepunktet: (1) én linje per seksjon = summen av månedsrapportene i perioden, og
 * linjer uten mottaker blir stående uten å faktureres; (2) samme måned kan ikke kjøres
 * to ganger; (3) sendingen går gjennom det generiske regnskapslaget — Fiken er ett
 * adapter, og kallstedene vet ikke hvilket; (4) Fiken-adapteret slår opp på
 * `orderReference` før det oppretter, så et nytt forsøk aldri dobbeltfakturerer, og mva
 * følger foretaket; (5) referansene skrives tilbake på linjene i samme transaksjon.
 *
 * Easee og Fiken er stubbet (`fetch`). Timesforbruket legges rett i basen — rapporten er
 * testet i tests/easee.test.ts.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import type { Aktor } from "../src/lib/aktor";
import { lovligeMvaKoder } from "../src/lib/fiken";
import { fikenLinje } from "../src/lib/fikenfaktura";
import { krypter } from "../src/lib/kryptering";
import {
  annullerLadekjoring,
  eksporterLadekjoring,
  endreLadekjoring,
  hentLadekjoringer,
  opprettLadekjoring,
  periodeEtikett,
  periodeFra,
  sendLadekjoring,
} from "../src/lib/ladekjoring";
import { REGNSKAPSSYSTEMER, regnskapNavn } from "../src/lib/regnskap";
import { hentRegnskap } from "../src/lib/regnskapskobling";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const kari: Aktor = { navn: "Kari Styreleder", brukerId: null };

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
  process.env.INTEGRASJON_NOKKEL ??= "ab".repeat(32);
});

afterAll(async () => {
  eier.release();
  await eierPool.end();
  await lukkPooler();
});

beforeEach(() => vi.unstubAllGlobals());

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const id of ryddOrg.splice(0)) {
    for (const t of ["charging_run_lines", "charging_runs", "easee_charger_hours", "easee_sessions", "easee_price_plans", "easee_chargers", "easee_settings", "fiken_connections", "audit_events", "parking_leases", "parking_spots", "unit_owners", "units"]) {
      await eier.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
    }
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

/**
 * Et lite anlegg: to seksjoner med eier (H0101 Ola, H0102 Kari) på plass G01/G02 med hver
 * sin lader, og en tredje lader på en plass uten seksjon. Timer i juli og august 2026,
 * Norgespris 50 øre, nett 45/33, fastledd 100 kr.
 */
async function oppsett(opts: { medEier2?: boolean } = {}) {
  const orgId = `lk-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [orgId, "Ladelaget", orgId]);
  ryddOrg.push(orgId);
  const u1 = randomUUID(), u2 = randomUUID();
  await eier.query("INSERT INTO units (id, org_id, type, leilighetsnr) VALUES ($1,$2,'bolig','H0101'), ($3,$2,'bolig','H0102')", [u1, orgId, u2]);
  const o1 = randomUUID();
  await eier.query("INSERT INTO unit_owners (id, org_id, unit_id, name, email, owner_from) VALUES ($1,$2,$3,'Ola Beboer','ola@example.org','2020-01-01')", [o1, orgId, u1]);
  if (opts.medEier2 !== false) {
    await eier.query("INSERT INTO unit_owners (id, org_id, unit_id, name, email, owner_from) VALUES ($1,$2,$3,'Kari Nabo',NULL,'2021-01-01')", [randomUUID(), orgId, u2]);
  }
  const p1 = randomUUID(), p2 = randomUUID(), p3 = randomUUID();
  await eier.query("INSERT INTO parking_spots (id, org_id, number, unit_label, unit_id, has_charger) VALUES ($1,$2,'G01','H0101',$3,true), ($4,$2,'G02','H0102',$5,true), ($6,$2,'G03','Gjest',NULL,true)", [p1, orgId, u1, p2, u2, p3]);
  const l1 = randomUUID(), l2 = randomUUID(), l3 = randomUUID();
  await eier.query("INSERT INTO easee_chargers (id, org_id, charger_id, name, spot_id) VALUES ($1,$2,'EH1','Lader 1',$3), ($4,$2,'EH2','Lader 2',$5), ($6,$2,'EH3','Lader 3',$7)", [l1, orgId, p1, l2, p2, l3, p3]);
  const timer: Array<[string, string, number]> = [
    [l1, "2026-07-06T10:00:00Z", 10], [l1, "2026-07-06T21:00:00Z", 4], // juli: 10 dag, 4 natt
    [l1, "2026-08-03T10:00:00Z", 20], // august: 20 dag
    [l2, "2026-07-20T12:00:00Z", 2], // juli: 2 dag
    [l3, "2026-07-21T12:00:00Z", 5], // gjesteplass uten seksjon
  ];
  for (const [lader, iso, kwh] of timer) {
    await eier.query("INSERT INTO easee_charger_hours (id, org_id, charger_row_id, hour_start, kwh) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), orgId, lader, iso, kwh]);
  }
  await eier.query(
    "INSERT INTO easee_price_plans (id, org_id, valid_from, name, kraft_model, kraft_ore, nett_dag_ore, nett_natt_ore, fastledd_ore, created_by) VALUES ($1,$2,'2026-01-01','Norgespris','norgespris',50,45,33,10000,'Kari')",
    [randomUUID(), orgId],
  );
  return { orgId, u1, u2, o1 };
}

async function medFiken(orgId: string) {
  await eier.query(
    "INSERT INTO fiken_connections (id, org_id, company_slug, company_name, vat_type, auth_mode, access_token_enc, connected_by) VALUES ($1,$2,'demo-sameie','Sameiet Demo','no','api_key',$3,'Kari')",
    [randomUUID(), orgId, krypter("fiken-token")],
  );
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

async function feilFra(fn: () => Promise<unknown>): Promise<ApiFeil> {
  try { await fn(); } catch (e) { return e as ApiFeil; }
  throw new Error("Forventet en feil, men kallet gikk gjennom");
}

/** Stubber Fiken: bankkonto, kunder (medlemsnummer), fakturaer (ordrereferanse), teller, sending. */
function stubbFiken(valg: { fakturaerFraFor?: Array<{ orderReference: string; invoiceId: number; invoiceNumber: number; kreditert?: boolean; sendt?: boolean; customerId?: number }>; kunder?: Array<{ contactId: number; name: string; email?: string | null; memberNumberString: string }>; tellerMangler?: boolean; feilVedFakturaNr?: number } = {}) {
  const kall: Array<{ metode: string; sti: string; kropp?: unknown }> = [];
  const kunder: Array<{ contactId: number; name: string; email?: string | null; memberNumberString: string }> = [...(valg.kunder ?? [])];
  const fakturaer = [...(valg.fakturaerFraFor ?? [])].map((f) => ({ ...f, customer: { contactId: f.customerId ?? 0 }, associatedCreditNotes: f.kreditert ? [1] : [], dispatches: f.sendt ? [{ date: "2026-08-01", dispatchType: "email" }] : [] }));
  let neste = 6000; // over de forhåndslagde kundene (5001 …), så id-ene aldri kolliderer
  let teller = !valg.tellerMangler;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const metode = init?.method ?? "GET";
    const kropp = init?.body ? JSON.parse(String(init.body)) : undefined;
    kall.push({ metode, sti: `${u.pathname}${u.search}`, kropp });
    if (u.hostname !== "api.fiken.no") return new Response("not found", { status: 404 });
    if ((init?.headers as Record<string, string>)?.Authorization !== "Bearer fiken-token") return Response.json({ message: "Unauthorized" }, { status: 401 });
    const sti = u.pathname.replace("/api/v2/companies/demo-sameie", "");
    if (sti === "/bankAccounts") return Response.json([{ bankAccountId: 1, accountCode: "1920:10001", bankAccountNumber: "12345678903", type: "normal", inactive: false }]);
    if (sti === "/contacts" && metode === "GET") return Response.json(kunder.filter((k) => k.memberNumberString === u.searchParams.get("memberNumberString")));
    if (sti === "/contacts" && metode === "POST") {
      const id = ++neste;
      kunder.push({ contactId: id, name: kropp.name, email: kropp.email ?? null, memberNumberString: kropp.memberNumberString });
      return new Response(null, { status: 201, headers: { Location: `https://api.fiken.no/api/v2/companies/demo-sameie/contacts/${id}` } });
    }
    if (sti === "/invoices" && metode === "GET") {
      const kunde = Number(u.searchParams.get("customerId"));
      return Response.json(fakturaer.filter((f) => f.orderReference === u.searchParams.get("orderReference") && (!kunde || f.customer.contactId === kunde)));
    }
    if (sti === "/invoices/counter" && metode === "POST") { teller = true; return new Response(null, { status: 201 }); }
    if (sti === "/invoices" && metode === "POST") {
      if (!teller) return Response.json({ message: "invoice counter not initialized" }, { status: 409 });
      // Som ekte Fiken: konto 3100 godtar ikke NONE, bare fritatt-kodene.
      if (kropp.lines[0].incomeAccount === "3100" && kropp.lines[0].vatType === "NONE") {
        return Response.json({ message: "SALG_INNTEKTER_UTEN_MVABEHANDLING er ikke en gyldig mva kode for kontoen 3100. Mulige mva koder er [SALG_FRITATT_FOR_MVA_AVGIFTSFRITT, SALG_UTFØRSEL_AV_VARER_OG_TJENESTER, SALG_INNENLANDSK_OMSETNING_MED_OMVENDT_AVGIFTPLIKT]" }, { status: 400 });
      }
      if (valg.feilVedFakturaNr && fakturaer.length + 1 === valg.feilVedFakturaNr) return Response.json({ message: "Fiscal year 2027 is invalid" }, { status: 400 });
      const id = ++neste;
      fakturaer.push({ orderReference: kropp.orderReference, invoiceId: id, invoiceNumber: 10000 + fakturaer.length + 1, customer: { contactId: kropp.customerId }, associatedCreditNotes: [], dispatches: [] });
      return new Response(null, { status: 201, headers: { Location: `https://api.fiken.no/api/v2/companies/demo-sameie/invoices/${id}` } });
    }
    const en = /^\/invoices\/(\d+)$/.exec(sti);
    if (en && metode === "GET") {
      const f = fakturaer.find((x) => x.invoiceId === Number(en[1]));
      return f ? Response.json(f) : Response.json({ message: "not found" }, { status: 404 });
    }
    if (sti === "/invoices/send" && metode === "POST") {
      if (!("includeDocumentAttachments" in kropp) || "emailAddress" in kropp) return Response.json({ message: "Ugyldig sendeforespørsel" }, { status: 400 });
      const f = fakturaer.find((x) => x.invoiceId === kropp.invoiceId);
      if (f) f.dispatches.push({ date: "2026-08-01", dispatchType: "email" });
      return new Response(null, { status: 200 });
    }
    return Response.json({ message: `ukjent ${metode} ${sti}` }, { status: 404 });
  }));
  return { kall, kunder, fakturaer };
}

describe("regnskapslaget", () => {
  it("navngir systemet fra registeret — «regnskapet» uten kobling, Fiken med", async () => {
    expect(regnskapNavn(null)).toBe("regnskapet");
    expect(regnskapNavn("fiken")).toBe("Fiken");
    expect(regnskapNavn("tripletex")).toBe("Tripletex");
    expect(Object.keys(REGNSKAPSSYSTEMER)).toEqual(["fiken", "tripletex"]);
    const { orgId } = await oppsett();
    const uten = await i(orgId, (db) => hentRegnskap(db, orgId));
    expect(uten).toMatchObject({ system: null, navn: "regnskapet", kanFakturere: false });
    await medFiken(orgId);
    const med = await i(orgId, (db) => hentRegnskap(db, orgId));
    expect(med).toMatchObject({ system: "fiken", navn: "Fiken", foretak: "Sameiet Demo", kanFakturere: true, grunn: null });
  });

  it("mva følger foretaket og kontoen: uten mva → NONE, ellers den koden Fiken sier kontoen godtar", () => {
    expect(fikenLinje(12500, "no")).toEqual({ unitPrice: 12500, vatType: "NONE" });
    expect(fikenLinje(12500, null)).toEqual({ unitPrice: 12500, vatType: "NONE" });
    expect(fikenLinje(12500, "yes")).toEqual({ unitPrice: 10000, vatType: "HIGH" });
    // Fikens svar for 3100 (06.09.2026): fritatt, utførsel, omvendt avgiftsplikt — vi tar «fritatt».
    const lovlige = lovligeMvaKoder("SALG_INNTEKTER_UTEN_MVABEHANDLING er ikke en gyldig mva kode for kontoen 3100. Mulige mva koder er [SALG_FRITATT_FOR_MVA_AVGIFTSFRITT, SALG_UTF\uFFFDRSEL_AV_VARER_OG_TJENESTER, SALG_INNENLANDSK_OMSETNING_MED_OMVENDT_AVGIFTPLIKT]");
    expect(lovlige).toEqual(["EXEMPT", "EXEMPT_IMPORT_EXPORT", "EXEMPT_REVERSE"]);
    expect(fikenLinje(12500, "no", lovlige)).toEqual({ unitPrice: 12500, vatType: "EXEMPT" });
    // 3605 godtar bare lav/høy sats — et uregistrert sameie skal bytte konto, ikke fakturere mva.
    const bareMva = lovligeMvaKoder("… for kontoen 3605. Mulige mva koder er [SALG_MED_LAV_SATS, SALG_MED_HØY_SATS]");
    expect(bareMva).toEqual(["LOW", "HIGH"]);
    expect(() => fikenLinje(12500, "no", bareMva)).toThrow(/avgiftsfri inntektskonto/);
    expect(fikenLinje(12500, "yes", bareMva)).toEqual({ unitPrice: 10000, vatType: "HIGH" });
    expect(lovligeMvaKoder("Fiscal year 2027 is invalid")).toEqual([]);
  });

  it("perioder: hele måneder, fra 1., etikett på norsk", () => {
    expect(periodeFra("2026-07-01", 1)).toMatchObject({ start: "2026-07-01", slutt: "2026-07-31" });
    expect(periodeFra("2026-07-01", 6).slutt).toBe("2026-12-31");
    expect(periodeFra("2026-11-01", 3)).toMatchObject({ slutt: "2027-01-31", maanedene: [{ aar: 2026, maaned: 11 }, { aar: 2026, maaned: 12 }, { aar: 2027, maaned: 1 }] });
    expect(() => periodeFra("2026-07-15", 1)).toThrow(/den 1\./);
    expect(periodeEtikett("2026-07-01", "2026-07-31")).toBe("juli 2026");
    expect(periodeEtikett("2026-07-01", "2026-12-31")).toBe("juli 2026 – desember 2026");
  });
});

describe("ladekjøringen", () => {
  it("én linje per seksjon med summen av månedene; plass uten seksjon blir linje uten mottaker", async () => {
    const { orgId, u1, u2, o1 } = await oppsett();
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 3, dueDate: "2026-10-15", incomeAccount: "3605", note: null }));
    expect(k.etikett).toBe("juli 2026 – september 2026");
    expect(k.lineCount).toBe(3);
    expect(k.missingRecipients).toBe(1);
    const h1 = k.linjer.find((l) => l.unitId === u1)!;
    // Juli: 10 dag + 4 natt, august: 20 dag → 34 kWh; kraft 34×50 = 1700; nett 30×45 + 4×33 = 1482; fastledd 3 mnd × 100 kr.
    expect(h1).toMatchObject({ ownerId: o1, ownerName: "Ola Beboer", ownerEmail: "ola@example.org", unitLabel: "H0101", kwh: 34, kwhDay: 30, kwhNight: 4, energyAmount: 1700, gridAmount: 1482, fixedAmount: 30_000, amount: 33_182, issue: null });
    expect(h1.orderReference).toBe("Lading juli 2026 – september 2026");
    expect(h1.description).toBe("Lading juli 2026 – september 2026 · plass G01");
    const h2 = k.linjer.find((l) => l.unitId === u2)!;
    expect(h2).toMatchObject({ ownerName: "Kari Nabo", ownerEmail: null, kwh: 2, amount: 2 * 95 + 30_000 });
    const gjest = k.linjer.find((l) => !l.unitId)!;
    expect(gjest).toMatchObject({ issue: "Plassen mangler seksjon", kwh: 5, ownerId: null });
    expect(k.totalAmount).toBe(h1.amount + h2.amount);
    expect(k.totalKwh).toBe(41);

    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 AND entity = 'ladekjoring'", [orgId]);
    expect(logg.rows[0].event).toBe("Laget fakturagrunnlag for lading juli 2026 – september 2026: 2 linjer, 633,72 kr, 1 uten mottaker");
  });

  it("avviser overlapp, manglende prisplan og tom periode; annullert kjøring frigjør perioden", async () => {
    const { orgId } = await oppsett();
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    const e1 = await feilFra(() => i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-06-01", maaneder: 3, dueDate: "2026-09-15", incomeAccount: "3605", note: null })));
    expect(e1.status).toBe(409);
    expect(e1.message).toMatch(/juli 2026 er allerede kjørt/);
    const e2 = await feilFra(() => i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2025-11-01", maaneder: 1, dueDate: "2025-12-15", incomeAccount: "3605", note: null })));
    expect(e2.message).toMatch(/november 2025: ingen prisplan/);
    // En måned uten lading gir likevel fastledd for plassene med lader — det er riktig, ikke tomt.
    const mars = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-03-01", maaneder: 1, dueDate: "2026-04-15", incomeAccount: "3605", note: null }));
    expect(mars.linjer.map((l) => l.amount)).toEqual([10_000, 10_000, 10_000]);
    expect(mars.totalKwh).toBe(0);
    await i(orgId, (db) => annullerLadekjoring(db, orgId, k.id, kari));
    const igjen = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    expect(igjen.status).toBe("grunnlag");
    expect((await i(orgId, (db) => hentLadekjoringer(db, orgId))).map((x) => x.status).sort()).toEqual(["annullert", "grunnlag", "grunnlag"]);
  });

  it("forfall og konto kan rettes på et grunnlag, ikke på en sendt kjøring", async () => {
    const { orgId } = await oppsett();
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    const e = await i(orgId, (db) => endreLadekjoring(db, orgId, k.id, kari, { incomeAccount: "3600", dueDate: "2026-08-20" }));
    expect(e).toMatchObject({ incomeAccount: "3600", dueDate: "2026-08-20" });
    await medFiken(orgId);
    stubbFiken();
    await i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari));
    const f = await feilFra(() => i(orgId, (db) => endreLadekjoring(db, orgId, k.id, kari, { incomeAccount: "3605" })));
    expect(f.message).toMatch(/ikke er sendt/);
  });

  it("CSV har én rad per linje med beløp i kroner og merknad for linjer uten mottaker", async () => {
    const { orgId } = await oppsett();
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    const csv = await i(orgId, (db) => eksporterLadekjoring(db, orgId, k.id, kari));
    const tekst = new TextDecoder().decode(csv.innhold);
    expect(csv.navn).toBe("lading-2026-07-01-2026-07-31.csv");
    expect(tekst.trim().split("\n").length).toBe(4); // hode + 3 linjer
    expect(tekst).toContain("Ola Beboer");
    expect(tekst).toContain("Plassen mangler seksjon");
  });

  it("sending uten regnskapskobling avvises med grunn — ikke med «Fiken»", async () => {
    const { orgId } = await oppsett();
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    const e = await feilFra(() => i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari)));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/Ingen regnskapskobling/);
    expect(e.message).not.toMatch(/Fiken/);
  });
});

describe("sending til Fiken", () => {
  it("oppretter kunde og faktura per seksjon, sender på e-post der adressen finnes, og skriver referansene tilbake", async () => {
    const { orgId, u1, u2 } = await oppsett();
    await medFiken(orgId);
    const { kall, kunder, fakturaer } = stubbFiken({ tellerMangler: true });
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    const sendt = await i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari, new Date("2026-08-01T10:00:00Z")));
    expect(sendt.status).toBe("sendt");
    expect(sendt.sentTo).toBe("fiken");

    // Kundene: seksjonens id som medlemsnummer, e-post der den finnes.
    expect(kunder.map((x) => [x.memberNumberString, x.name, x.email])).toEqual([[u1, "Ola Beboer", "ola@example.org"], [u2, "Kari Nabo", null]]);
    // Fakturaene: brutto uten mva (sameiet er ikke mva-registrert), konto fra kjøringen, referanse = idempotensnøkkelen.
    const post = kall.filter((x) => x.metode === "POST" && x.sti.endsWith("/invoices")).map((x) => x.kropp as { customerId: number; bankAccountCode: string; orderReference: string; issueDate: string; dueDate: string; cash: boolean; lines: Array<{ unitPrice: number; vatType: string; incomeAccount: string; description: string; quantity: number }> });
    expect(post.length).toBe(3); // 409 første gang (teller), så to som gikk
    expect(post[1]).toMatchObject({ bankAccountCode: "1920:10001", orderReference: "Lading juli 2026", issueDate: "2026-08-01", dueDate: "2026-08-15", cash: false });
    // Oppslaget før opprettelse er på referanse OG kunde — samme tekst hos to eiere er to fakturaer.
    expect(kall.filter((x) => x.metode === "GET" && x.sti.includes("/invoices?")).every((x) => x.sti.includes("customerId="))).toBe(true);
    expect(post[1]!.lines[0]).toMatchObject({ unitPrice: 10_000 + 14 * 50 + 10 * 45 + 4 * 33, vatType: "NONE", incomeAccount: "3605", quantity: 1 });
    expect(post[1]!.lines[0]!.description).toContain("plass G01");
    expect(kall.some((x) => x.sti.endsWith("/invoices/counter"))).toBe(true);
    // Sending bare til den som har e-post.
    const send = kall.filter((x) => x.sti.endsWith("/invoices/send")).map((x) => x.kropp as { invoiceId: number; recipientEmail?: string; method: string[]; includeDocumentAttachments: boolean });
    expect(send.length).toBe(1);
    expect(send[0]).toMatchObject({ recipientEmail: "ola@example.org", method: ["email"], includeDocumentAttachments: true });
    // Referansene på linjene.
    const l1 = sendt.linjer.find((l) => l.unitId === u1)!;
    expect(l1.externalRef).toBe(String(fakturaer[0]!.invoiceId));
    expect(l1.externalNumber).toBe("10001");
    expect(l1.sentToRecipient).not.toBeNull();
    const l2 = sendt.linjer.find((l) => l.unitId === u2)!;
    expect(l2.externalNumber).toBe("10002");
    expect(l2.sentToRecipient).toBeNull();
    expect(sendt.linjer.find((l) => !l.unitId)!.externalRef).toBeNull();
    // Aldri i parallell, aldri betalinger, aldri sletting.
    expect(kall.every((x) => x.metode === "GET" || x.metode === "POST")).toBe(true);
    const logg = await eier.query("SELECT event FROM audit_events WHERE org_id = $1 AND entity = 'ladekjoring' ORDER BY occurred_at DESC LIMIT 1", [orgId]);
    expect(logg.rows[0].event).toMatch(/^Sendte 2 ladefakturaer for juli 2026 til Fiken \(Sameiet Demo\), .* kr — 1 sendt på e-post$/);
    // Sendt kjøring kan ikke annulleres herfra.
    const e = await feilFra(() => i(orgId, (db) => annullerLadekjoring(db, orgId, k.id, kari)));
    expect(e.message).toMatch(/sendt til Fiken — fakturaene må krediteres der/);
  });

  it("feil midt i: ingenting lagres, og neste forsøk gjenbruker fakturaen som allerede finnes på referansen", async () => {
    const { orgId, u1 } = await oppsett();
    await medFiken(orgId);
    stubbFiken({ feilVedFakturaNr: 2 });
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    const e = await feilFra(() => i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari)));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/Fiscal year 2027 is invalid/);
    expect(e.message).toMatch(/1 av 2 opprettet før feilen/);
    const rad = await eier.query("SELECT status FROM charging_runs WHERE id = $1", [k.id]);
    expect(rad.rows[0].status).toBe("grunnlag");

    // Nytt forsøk: fakturaen for H0101 finnes hos Fiken på referansen — den gjenbrukes, ikke dobles.
    const { kall } = stubbFiken({ fakturaerFraFor: [{ orderReference: "Lading juli 2026", invoiceId: 777, invoiceNumber: 10009, customerId: 5001 }], kunder: [{ contactId: 5001, name: "Ola Beboer", email: "ola@example.org", memberNumberString: u1 }] });
    const sendt = await i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari));
    expect(sendt.status).toBe("sendt");
    expect(sendt.linjer.find((l) => l.unitId === u1)).toMatchObject({ externalRef: "777", externalNumber: "10009" });
    expect(kall.filter((x) => x.metode === "POST" && x.sti.endsWith("/invoices")).length).toBe(1);
    // Fakturaen som fantes fra før var aldri sendt (ingen dispatches) — nå sendes den, og linja får tidspunkt.
    expect(kall.filter((x) => x.sti.endsWith("/invoices/send")).map((x) => (x.kropp as { invoiceId: number }).invoiceId)).toContain(777);
    expect(sendt.linjer.find((l) => l.unitId === u1)!.sentToRecipient).not.toBeNull();
  });

  it("konto 3100: Fiken avviser NONE og oppgir kodene — adapteret prøver igjen med «fritatt»", async () => {
    const { orgId, u1 } = await oppsett({ medEier2: false });
    await medFiken(orgId);
    const { kall } = stubbFiken();
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3100", note: null }));
    const sendt = await i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari));
    const post = kall.filter((x) => x.metode === "POST" && x.sti.endsWith("/invoices")).map((x) => (x.kropp as { lines: Array<{ vatType: string; unitPrice: number }> }).lines[0]);
    expect(post.map((l) => l!.vatType)).toEqual(["NONE", "EXEMPT"]);
    expect(post[1]!.unitPrice).toBe(post[0]!.unitPrice); // fritatt = samme beløp, ingen mva trukket ut
    expect(sendt.linjer.find((l) => l.unitId === u1)!.externalNumber).toBe("10001");
  });

  it("en sendt kjøring kan sendes på nytt bare for e-postene som mangler — ingenting opprettes igjen", async () => {
    const { orgId, u1 } = await oppsett({ medEier2: false });
    await medFiken(orgId);
    // Fakturaen finnes og ER sendt fra før → ingen ny sending, og kjøringen regnes som ferdig.
    const { kall } = stubbFiken({ fakturaerFraFor: [{ orderReference: "Lading juli 2026", invoiceId: 900, invoiceNumber: 10020, sendt: true, customerId: 5001 }], kunder: [{ contactId: 5001, name: "Ola Beboer", email: "ola@example.org", memberNumberString: u1 }] });
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3100", note: null }));
    const sendt = await i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari));
    expect(kall.filter((x) => x.sti.endsWith("/invoices/send")).length).toBe(0);
    // Fiken hadde sendt den fra før — da er den levert hos oss også, og kjøringen er ferdig.
    expect(sendt.linjer.find((l) => l.unitId === u1)!.sentToRecipient).not.toBeNull();
    const e = await feilFra(() => i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari)));
    expect(e.message).toMatch(/allerede sendt/);
  });

  it("kreditert faktura på referansen teller ikke — det lages en ny", async () => {
    const { orgId, u1 } = await oppsett({ medEier2: false });
    await medFiken(orgId);
    const { kall } = stubbFiken({ fakturaerFraFor: [{ orderReference: "Lading juli 2026", invoiceId: 1, invoiceNumber: 10001, kreditert: true, customerId: 5001 }], kunder: [{ contactId: 5001, name: "Ola Beboer", email: "ola@example.org", memberNumberString: u1 }] });
    const k = await i(orgId, (db) => opprettLadekjoring(db, orgId, kari, { periodStart: "2026-07-01", maaneder: 1, dueDate: "2026-08-15", incomeAccount: "3605", note: null }));
    expect(k.missingRecipients).toBe(2); // gjest uten seksjon + H0102 uten eier
    const sendt = await i(orgId, (db) => sendLadekjoring(db, orgId, k.id, kari));
    expect(kall.filter((x) => x.metode === "POST" && x.sti.endsWith("/invoices")).length).toBe(1);
    expect(sendt.linjer.find((l) => l.unitId === u1)!.externalNumber).toBe("10002");
  });
});
