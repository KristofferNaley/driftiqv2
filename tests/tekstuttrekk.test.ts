/**
 * Tekstuttrekk og tekstsøk i dokumenter (docs/tekstsok.md). Ingen v1-forgjenger.
 *
 * Tyngdepunktet: (1) en PDF med tekstlag gir tekst uten OCR, en skannet PDF går til OCR når
 * verktøyene finnes og merkes ærlig når de ikke gjør det; (2) et dokument forsøkes ÉN gang,
 * uansett utfall, og feil blir en merknad på raden — ikke en jobb som velter; (3) teksten
 * når aldri klienten (`hentDokument`/`hentDokumenter`), men det globale søket treffer på
 * den og viser et utdrag rundt ordet; (4) jobben går på tvers av orger uten å blande dem.
 *
 * PDF-ene lages for hånd her (minimal PDF 1.4 med Helvetica) — pdf.js reparerer en
 * unøyaktig xref selv, så ingen PDF-bibliotek trengs for å skrive dem.
 */

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { lukkPooler, withOrg } from "../src/db/client";
import { hentDokument, hentDokumenter, lastOppDokument } from "../src/lib/dokumenter";
import { hentGlobaltSok } from "../src/lib/sok";
import {
  MAKS_TEKST,
  antallVentende,
  kjorTekstuttrekk,
  nullstillTekst,
  ocrErTilgjengelig,
  ryddTekst,
  uttrekkForDokument,
  uttrekkTekst,
} from "../src/lib/tekstuttrekk";

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
    await eier.query("DELETE FROM documents WHERE org_id = $1", [id]);
    await eier.query("DELETE FROM organizations WHERE id = $1", [id]);
    await rm(path.join(process.env.UPLOAD_DIR ?? "/app/uploads", "orgs", id), { recursive: true, force: true });
  }
});

async function nyOrg(): Promise<string> {
  const id = `tek-${randomUUID()}`;
  // Dokumentarkivet er AV som standard — søket spør ikke tabellen uten modulen på.
  await eier.query("INSERT INTO organizations (id, name, slug, active, enabled_modules) VALUES ($1,$2,$3,true,$4)", [
    id, "Tekstlaget", id, JSON.stringify(["dashboard", "dokumentarkiv"]),
  ]);
  ryddOrg.push(id);
  return id;
}

const i = <T>(orgId: string, fn: Parameters<typeof withOrg<T>>[1]) => withOrg(orgId, fn);

/**
 * Minimal PDF med én side og gitt tekst i Helvetica, brukket i linjer på ~45 tegn: pdf.js
 * dropper tekst som havner utenfor siden, så én lang linje ville mistet slutten.
 * `tomSide = true` gir en side uten tekst (en «skannet» side).
 */
function lagPdf(tekst: string, opts: { tomSide?: boolean } = {}): Buffer {
  const esc = (t: string) => t.replace(/[()\\]/g, (x) => `\\${x}`);
  const linjer = tekst.match(/.{1,45}(\s|$)/g) ?? [tekst];
  const innhold = opts.tomSide
    ? "0 0 m 100 100 l S"
    : `BT /F1 18 Tf 22 TL 40 760 Td ${linjer.map((l) => `(${esc(l.trim())}) Tj T*`).join(" ")} ET`;
  const objekter = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(innhold)} >>\nstream\n${innhold}\nendstream`,
  ];
  let ut = "%PDF-1.4\n";
  const posisjoner: number[] = [];
  objekter.forEach((o, n) => {
    posisjoner.push(Buffer.byteLength(ut));
    ut += `${n + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(ut);
  ut += `xref\n0 ${objekter.length + 1}\n0000000000 65535 f \n`;
  for (const p of posisjoner) ut += `${String(p).padStart(10, "0")} 00000 n \n`;
  ut += `trailer\n<< /Size ${objekter.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(ut, "latin1");
}

const pdfFil = (navn: string, tekst: string, opts?: { tomSide?: boolean }) =>
  new File([new Uint8Array(lagPdf(tekst, opts))], navn, { type: "application/pdf" });

const dok = (over: Record<string, unknown> = {}) => ({
  title: "Testdokument",
  description: null,
  folder: "annet",
  documentDate: null,
  aiReadable: false,
  ...over,
});

describe("uttrekkTekst", () => {
  it("PDF med tekstlag gir teksten uten OCR", async () => {
    // Over 40 tegn på siden — under det regnes PDF-en som skannet (terskelen i tekstuttrekk.ts).
    const r = await uttrekkTekst(lagPdf("Vannlekkasje i kjelleren under vaskeriet, meldt av vaktmester tirsdag"), "application/pdf", { ocr: false });
    expect(r.kilde).toBe("pdf");
    expect(r.sider).toBe(1);
    expect(r.tekst).toContain("Vannlekkasje i kjelleren");
    expect(r.merknad).toBeNull();
  });

  it("skannet PDF (uten tekst) merkes ærlig når OCR er av", async () => {
    const r = await uttrekkTekst(lagPdf("", { tomSide: true }), "application/pdf", { ocr: false });
    expect(r.kilde).toBe("ingen");
    expect(r.tekst).toBe("");
    expect(r.merknad).toMatch(/Skannet PDF/);
  });

  it("OCR leser teksten fra bildet av siden når verktøyene finnes i imaget", async () => {
    // Imaget skal ha tesseract + poppler (Dockerfile). Mangler de, er det en byggefeil —
    // men lokalt utenfor Docker hopper vi over i stedet for å feile på noe som ikke kan rettes her.
    if (!(await ocrErTilgjengelig())) {
      console.warn("OCR-verktøy mangler — hopper over OCR-testen");
      return;
    }
    const r = await uttrekkTekst(lagPdf("HEISKONTROLL GODKJENT 2026"), "application/pdf", { tvingOcr: true });
    expect(r.kilde).toBe("ocr");
    expect(r.tekst.toUpperCase()).toContain("HEISKONTROLL");
  });

  it("formater uten tekst får en forklarende merknad, aldri en feil", async () => {
    const doc = await uttrekkTekst(Buffer.from("x"), "application/msword");
    expect(doc.kilde).toBe("ingen");
    expect(doc.merknad).toMatch(/\.doc/);
    const heic = await uttrekkTekst(Buffer.from("x"), "image/heic");
    expect(heic.merknad).toMatch(/HEIC/);
  });

  it("ryddTekst normaliserer mellomrom og kapper ved MAKS_TEKST", () => {
    expect(ryddTekst("  a  \r\n\n\n\n b \t c ")).toBe("a\n\nb c");
    expect(ryddTekst("x".repeat(MAKS_TEKST + 10)).length).toBe(MAKS_TEKST);
  });
});

describe("per dokument og jobben", () => {
  it("skriver teksten på raden, men sender den aldri til klienten", async () => {
    const org = await nyOrg();
    const d = await i(org, (db) => lastOppDokument(db, org, "Kari", pdfFil("rapport.pdf", "Brannvarsler byttet i oppgang B"), dok()));
    expect((await i(org, (db) => hentDokument(db, org, d.id))).harTekst).toBe(false);

    const r = await i(org, (db) => uttrekkForDokument(db, org, d.id));
    expect(r.kilde).toBe("pdf");
    expect(r.tegn).toBeGreaterThan(20);

    const etter = await i(org, (db) => hentDokument(db, org, d.id));
    expect(etter.harTekst).toBe(true);
    expect(etter.textSource).toBe("pdf");
    expect("contentText" in etter).toBe(false);
    const liste = await i(org, (db) => hentDokumenter(db, org));
    expect("contentText" in liste[0]!).toBe(false);

    const rad = await eier.query("SELECT content_text FROM documents WHERE id = $1", [d.id]);
    expect(rad.rows[0].content_text).toContain("Brannvarsler byttet");
  });

  it("ødelagt fil forsøkes én gang og merkes med feil; nullstilling åpner for nytt forsøk", async () => {
    const org = await nyOrg();
    const d = await i(org, (db) => lastOppDokument(db, org, "Kari", new File([new Uint8Array([1, 2, 3])], "x.pdf", { type: "application/pdf" }), dok()));
    const r = await i(org, (db) => uttrekkForDokument(db, org, d.id));
    expect(r.kilde).toBe("feil");
    const etter = await i(org, (db) => hentDokument(db, org, d.id));
    expect(etter.textExtractedAt).not.toBeNull();
    expect(etter.textError).toMatch(/Kunne ikke lese fila/);
    expect(await antallVentende()).toBe(0);

    await i(org, (db) => nullstillTekst(db, org, d.id));
    expect((await i(org, (db) => hentDokument(db, org, d.id))).textExtractedAt).toBeNull();
  });

  it("jobben tar de ventende på tvers av orger, i hver sin org-kontekst", async () => {
    const a = await nyOrg();
    const b = await nyOrg();
    await i(a, (db) => lastOppDokument(db, a, "Kari", pdfFil("a.pdf", "Styremøte om takrenner"), dok()));
    await i(b, (db) => lastOppDokument(db, b, "Ola", pdfFil("b.pdf", "Tilbud på maling av fasade"), dok()));
    expect(await antallVentende()).toBeGreaterThanOrEqual(2);

    const r = await kjorTekstuttrekk({ grense: 50 });
    expect(r.behandlet).toBeGreaterThanOrEqual(2);
    expect(r.feil).toEqual([]);

    const ia = await i(a, (db) => hentDokumenter(db, a));
    const ib = await i(b, (db) => hentDokumenter(db, b));
    expect(ia.every((d) => d.harTekst)).toBe(true);
    expect(ib.every((d) => d.harTekst)).toBe(true);
    const rad = await eier.query("SELECT content_text FROM documents WHERE org_id = $1", [a]);
    expect(rad.rows[0].content_text).toContain("takrenner");
    expect(rad.rows[0].content_text).not.toContain("fasade");
  });
});

describe("søket", () => {
  it("treffer på innholdet i dokumentet og viser utdraget rundt ordet", async () => {
    const org = await nyOrg();
    const d = await i(org, (db) =>
      lastOppDokument(db, org, "Kari", pdfFil("tilstand.pdf", "Tilstandsrapport: det ble funnet en vannlekkasje bak dusjen i leilighet 12, og fuktskade i gulvet"), dok({ title: "Tilstandsrapport 2026" })),
    );
    await i(org, (db) => uttrekkForDokument(db, org, d.id));

    // Ord som bare finnes i innholdet — ikke i tittel, beskrivelse eller filnavn.
    const fts = await i(org, (db) => hentGlobaltSok(db, org, "fuktskade"));
    const treff = fts.find((t) => t.modul === "dokumentarkiv" && t.id === d.id);
    expect(treff).toBeDefined();
    expect(treff!.undertekst).toMatch(/«fuktskade»/);

    // Sammensatt ord: «lekkasje» treffer «vannlekkasje» bare via trigram-grenen på innholdet.
    const delord = await i(org, (db) => hentGlobaltSok(db, org, "lekkasje"));
    const t2 = delord.find((t) => t.modul === "dokumentarkiv" && t.id === d.id);
    expect(t2).toBeDefined();
    expect(t2!.undertekst).toMatch(/vannlekkasje/i);

    // Org B ser ikke dokumentet.
    const b = await nyOrg();
    expect((await i(b, (db) => hentGlobaltSok(db, b, "fuktskade"))).find((t) => t.id === d.id)).toBeUndefined();
  });
});
