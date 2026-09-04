/**
 * Fiken-koblingen (steg 2, lesing). Ingen v1-forgjenger.
 *
 * Tyngdepunktet: (1) hvitelista over lovlige kall er løftet til kunden og skal ikke kunne
 * utvides uten at denne fila endres; (2) tokens ligger aldri i klartekst og lekker aldri ut
 * av status-svaret; (3) synk speiler kjøp riktig og gir «faktisk» per konto i budsjettet,
 * som overstyrer godkjente fakturaer; (4) org A ser aldri org Bs kobling eller kjøp.
 *
 * Nettet er stubbet (`fetch`) — testene går aldri mot api.fiken.no.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import type { ApiFeil } from "../src/lib/api";
import type { Aktor } from "../src/lib/aktor";
import { TILLATTE_KALL, erTillatt, fikenKall, lagState, lesState, tilLokaltKjop, type FikenKjop } from "../src/lib/fiken";
import { faktiskFraFiken, hentKjopLokalt, hentKobling, kjopForLeverandor, kjopTilhorer, kobleFra, kobleTilMedNokkel, synkKjop } from "../src/lib/fikenkobling";
import { dekrypter, krypter } from "../src/lib/kryptering";
import { ER_TESTMILJO } from "../src/lib/miljo";
import { endreLinje, godkjennFaktura, hentBudsjett, opprettBudsjett, registrerFaktura } from "../src/lib/okonomi";

let eierPool: Pool;
let eier: PoolClient;
const ryddOrg: string[] = [];
const aktor: Aktor = { navn: "Test Testesen", brukerId: null };

beforeAll(async () => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
  eier = await eierPool.connect();
  // Testene trenger en krypteringsnøkkel — samme form som i .env, men aldri den ekte.
  process.env.FIKEN_TOKEN_KEY ??= "ab".repeat(32);
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
    await eier.query("DELETE FROM fiken_purchases WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM fiken_connections WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM supplier_invoices WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM budget_lines WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM budgets WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM audit_events WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM vendors WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
});

async function oppsett() {
  const orgId = `fik-${randomUUID()}`;
  await eier.query("INSERT INTO organizations (id, name, slug, active) VALUES ($1,$2,$3,true)", [orgId, "Fikenlaget", orgId]);
  ryddOrg.push(orgId);
  const vendorId = randomUUID();
  await eier.query("INSERT INTO vendors (id, org_id, name, active) VALUES ($1,$2,'Demo Rør AS',true)", [vendorId, orgId]);
  return { orgId, vendorId };
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

const kjop = (over: Partial<FikenKjop> = {}): FikenKjop => ({
  purchaseId: 100,
  identifier: "F-1",
  date: "2026-09-01",
  dueDate: "2026-09-15",
  kind: "supplier",
  paid: false,
  settled: false,
  deleted: false,
  lines: [{ description: "Heisservice", netPrice: 400_000, vat: 100_000, account: "6620" }],
  supplier: { name: "Heis AS", organizationNumber: "999999999" },
  ...over,
});

/** Stubber Fiken: /companies gir ett foretak, /purchases gir de oppgitte kjøpene. */
function stubbFiken(kjopene: FikenKjop[]) {
  const kall: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      kall.push(`${u.pathname}${u.search}`);
      if (u.pathname.endsWith("/companies")) {
        return Response.json([{ slug: "demo-sameie", name: "Demo Sameie", organizationNumber: "123456789", vatType: "no" }]);
      }
      if (u.pathname.endsWith("/purchases")) {
        return new Response(JSON.stringify(kjopene), {
          headers: { "content-type": "application/json", "fiken-api-page-count": "1", "fiken-api-result-count": String(kjopene.length) },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return kall;
}

describe("adapteret", () => {
  it("har en hviteliste med bare lesekall — skriving mot Fiken må legges til her, synlig", () => {
    expect(TILLATTE_KALL.every((k) => k.metode === "GET")).toBe(true);
    expect(erTillatt("GET", "/companies/demo-sameie/purchases?page=0")).toBe(true);
    expect(erTillatt("GET", "/companies/demo-sameie/invoices")).toBe(false);
    expect(erTillatt("POST" as "GET", "/companies/demo-sameie/purchases")).toBe(false);
  });

  it("nekter et kall utenfor hvitelista før noe går på nettet", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(fikenKall("t", "GET", "/companies/demo-sameie/invoices")).rejects.toThrow(/hvitelista/);
    expect(f).not.toHaveBeenCalled();
  });

  it("oversetter et kjøp til lokal form: brutto = netto + mva, konto som tall", () => {
    const l = tilLokaltKjop(kjop({ lines: [{ netPrice: 400_000, vat: 100_000, account: "6620" }, { netPrice: 1_000, vat: 0, account: "7770" }] }));
    expect(l.gross).toBe(501_000);
    expect(l.fikenId).toBe("100");
    expect(JSON.parse(l.lines)).toEqual([
      { account: 6620, description: null, net: 400_000, vat: 100_000, gross: 500_000 },
      { account: 7770, description: null, net: 1_000, vat: 0, gross: 1_000 },
    ]);
  });

  it("signerer state med org-id og avviser tukling og utløp", () => {
    process.env.BETTER_AUTH_SECRET ??= "test-hemmelighet";
    const s = lagState("org-a", 1_000_000);
    expect(lesState(s, 1_000_000 + 1000)).toEqual({ orgId: "org-a" });
    expect(lesState(s.slice(0, -2) + "xx", 1_000_000)).toBeNull();
    expect(lesState(s, 1_000_000 + 2 * 60 * 60 * 1000)).toBeNull();
  });
});

describe("kryptering", () => {
  it("krypterer og dekrypterer, og gir ulik chiffer for samme tekst", () => {
    const a = krypter("hemmelig-token");
    const b = krypter("hemmelig-token");
    expect(a).not.toBe(b);
    expect(dekrypter(a)).toBe("hemmelig-token");
    expect(a.startsWith("v1:")).toBe(true);
  });
});

describe("koblingen", () => {
  it("lagrer tokenet kryptert og viser det aldri i status", async () => {
    if (!ER_TESTMILJO) return; // nøkkelmodus finnes bare i testmiljøet
    const { orgId } = await oppsett();
    stubbFiken([]);
    const status = await i(orgId, (db) => kobleTilMedNokkel(db, orgId, aktor, { apiKey: "personlig-nokkel-123" }));
    expect(status.kobling?.companyName).toBe("Demo Sameie");
    expect(status.kobling?.authMode).toBe("api_key");
    expect(JSON.stringify(status)).not.toContain("personlig-nokkel");

    const rad = await eier.query("SELECT access_token_enc FROM fiken_connections WHERE org_id = $1", [orgId]);
    expect(rad.rows[0].access_token_enc).not.toContain("personlig-nokkel");
    expect(dekrypter(rad.rows[0].access_token_enc)).toBe("personlig-nokkel-123");
  });

  it("speiler kjøp, oppdaterer på nytt kjøp av samme id, og gir faktisk per konto til budsjettet", async () => {
    if (!ER_TESTMILJO) return;
    const { orgId, vendorId } = await oppsett();
    stubbFiken([kjop(), kjop({ purchaseId: 101, kind: "sale" })]);
    await i(orgId, (db) => kobleTilMedNokkel(db, orgId, aktor, { apiKey: "nokkel" }));

    const r1 = await i(orgId, (db) => synkKjop(db, orgId, new Date("2026-09-04T05:30:00Z")));
    expect(r1).toEqual({ ok: true, hentet: 2, nye: 1, oppdaterte: 0 }); // salget hoppes over

    // Samme kjøp igjen, nå betalt — oppdateres, dobles ikke.
    stubbFiken([kjop({ paid: true, settled: true })]);
    const r2 = await i(orgId, (db) => synkKjop(db, orgId));
    expect(r2).toEqual({ ok: true, hentet: 1, nye: 0, oppdaterte: 1 });
    const lokalt = await i(orgId, (db) => hentKjopLokalt(db, orgId, { aar: 2026 }));
    expect(lokalt.length).toBe(1);
    expect(lokalt[0]!.settled).toBe(true);

    // Budsjettet: kjøpet på 6620 havner på vedlikeholdslinja (6600–6629) og overstyrer
    // fakturaene styret har godkjent i DriftIQ.
    const b = await i(orgId, (db) => opprettBudsjett(db, orgId, aktor, { year: 2026 }));
    const vedl = b.linjer.find((l) => l.name === "Vedlikehold bygning og anlegg")!;
    await i(orgId, (db) => endreLinje(db, orgId, b.id, vedl.id, { amount: 10_000_000 }));
    const f = await i(orgId, (db) => registrerFaktura(db, orgId, aktor, { vendorId, invoiceDate: "2026-09-01", amount: 999, budgetLineId: vedl.id }));
    await i(orgId, (db) => godkjennFaktura(db, orgId, f.id, aktor, {}));

    const etter = await i(orgId, (db) => hentBudsjett(db, orgId, b.id));
    expect(etter.faktiskKilde).toBe("fiken");
    expect(etter.linjer.find((l) => l.id === vedl.id)!.faktisk).toBe(500_000);
    expect(etter.linjer.find((l) => l.name === "Forsikring")!.faktisk).toBe(0);

    // Frakobling sletter speilet, og faktisk faller tilbake til fakturaene.
    await i(orgId, (db) => kobleFra(db, orgId, aktor));
    expect((await i(orgId, (db) => hentKobling(db, orgId))).kobling).toBeNull();
    expect((await i(orgId, (db) => hentKjopLokalt(db, orgId))).length).toBe(0);
    const uten = await i(orgId, (db) => hentBudsjett(db, orgId, b.id));
    expect(uten.faktiskKilde).toBe("fakturaer");
    expect(uten.linjer.find((l) => l.id === vedl.id)!.faktisk).toBe(999);
  });

  it("lagrer feilen på raden når Fiken avviser — returnert, ikke kastet, så den overlever transaksjonen", async () => {
    if (!ER_TESTMILJO) return;
    const { orgId } = await oppsett();
    stubbFiken([]);
    await i(orgId, (db) => kobleTilMedNokkel(db, orgId, aktor, { apiKey: "nokkel" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"bad token"}', { status: 401 })));
    const r = await i(orgId, (db) => synkKjop(db, orgId));
    expect(r.ok).toBe(false);
    const s = await i(orgId, (db) => hentKobling(db, orgId));
    expect(s.kobling?.lastSyncError).toMatch(/avviste tilgangen/);
  });

  it("kobler kjøp til leverandøren på orgnr, ellers navn, og fyller «sist brukt»", async () => {
    if (!ER_TESTMILJO) return;
    expect(kjopTilhorer({ name: "Heis AS", orgNumber: "999 999 999" }, { supplierName: "HEIS AS", supplierOrgNumber: "999999999" })).toBe("orgnr");
    expect(kjopTilhorer({ name: "Heis AS", orgNumber: "111111111" }, { supplierName: "Heis AS", supplierOrgNumber: "999999999" })).toBeNull();
    expect(kjopTilhorer({ name: "Heis AS", orgNumber: null }, { supplierName: "heis as", supplierOrgNumber: "999999999" })).toBe("navn");

    const { orgId, vendorId } = await oppsett();
    await eier.query("UPDATE vendors SET org_number = '999 999 999' WHERE id = $1", [vendorId]);
    stubbFiken([kjop(), kjop({ purchaseId: 102, date: "2025-03-01", lines: [{ netPrice: 1_000, vat: 0, account: "6620" }] }), kjop({ purchaseId: 103, supplier: { name: "Andre AS", organizationNumber: "111111111" } })]);
    await i(orgId, (db) => kobleTilMedNokkel(db, orgId, aktor, { apiKey: "nokkel" }));
    await i(orgId, (db) => synkKjop(db, orgId));

    const r = await i(orgId, (db) => kjopForLeverandor(db, orgId, vendorId));
    expect(r.koblet).toBe(true);
    expect(r.treffPaa).toBe("orgnr");
    expect(r.kjop.length).toBe(2);
    expect(r.perAar).toEqual([{ aar: 2026, antall: 1, sum: 500_000 }, { aar: 2025, antall: 1, sum: 1_000 }]);
    expect(r.sisteKjop).toBe("2026-09-01");
    const lev = await eier.query("SELECT last_used_at::text AS d FROM vendors WHERE id = $1", [vendorId]);
    expect(lev.rows[0].d).toBe("2026-09-01");
  });

  it("ser ikke en annen orgs kobling eller kjøp", async () => {
    if (!ER_TESTMILJO) return;
    const a = await oppsett();
    const b = await oppsett();
    stubbFiken([kjop()]);
    await i(b.orgId, (db) => kobleTilMedNokkel(db, b.orgId, aktor, { apiKey: "nokkel" }));
    await i(b.orgId, (db) => synkKjop(db, b.orgId));

    expect((await i(a.orgId, (db) => hentKobling(db, a.orgId))).kobling).toBeNull();
    expect((await i(a.orgId, (db) => hentKjopLokalt(db, a.orgId))).length).toBe(0);
    expect(await i(a.orgId, (db) => faktiskFraFiken(db, a.orgId, 2026, []))).toBeNull();
    expect((await feilFra(() => i(a.orgId, (db) => synkKjop(db, a.orgId)))).status).toBe(404);
  });
});
