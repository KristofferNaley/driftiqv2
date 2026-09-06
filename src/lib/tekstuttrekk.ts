/**
 * Tekstuttrekk fra dokumenter — grunnlaget for tekstsøk i innholdet (docs/tekstsok.md).
 *
 * Tre lag, i rekkefølge fra billig til dyrt:
 *
 * 1. **Tekstlag** — PDF-er med innebygd tekst (unpdf/pdf.js) og Word (mammoth). Dekker de
 *    fleste dokumentene; i FDV-eksempelet i docs/fdv.md hadde 261 av 303 PDF-er tekstlag.
 * 2. **OCR lokalt** — tesseract med norsk språkdata, via `pdftoppm` for PDF-sider. Brukes
 *    når PDF-en er skannet (nesten ingen tekst per side) og for bilder. Ingenting forlater
 *    serveren; det er linja appen har trukket for dokumenter uten `aiReadable`.
 * 3. **Ikke mulig** — gammelt .doc, HEIC, eller OCR-verktøy som mangler i imaget. Raden
 *    merkes med hvorfor, så styret ser at fila ikke er søkbar.
 *
 * Uttrekket kjøres av bakgrunnsjobben «tekstuttrekk» (hvert 5. minutt) og rett etter
 * opplasting (`etterCommit` i dokumentruta). Et dokument forsøkes ÉN gang: både suksess og
 * feil setter `text_extracted_at`, ellers ville en ødelagt fil blitt forsøkt hvert femte
 * minutt for alltid. `nullstillTekst()` åpner for et nytt forsøk.
 *
 * Teksten kappes ved `MAKS_TEKST` — en tsvector kan ikke være over 1 MB, og 400 000 tegn
 * er mer enn noe styredokument (en 56-siders FDV-perm er ~150 000).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { withOrg, withoutRls, type Db } from "../db/client";
import { documents } from "../db/schema/dokumenter";
import { ikkeFunnet } from "./api";
import { filSti } from "./lagring";

const kjor = promisify(execFile);

export const MAKS_TEKST = 400_000;
/** Sider som OCR-es per PDF. Resten av en 200-siders perm er datablad, ikke det styret søker etter. */
export const MAKS_OCR_SIDER = 60;
/** Under dette snittet av tegn per side regnes PDF-en som skannet, og OCR prøves. */
const SKANNET_TERSKEL_TEGN_PER_SIDE = 40;
const OCR_TIDSGRENSE_MS = 90_000;

export type Tekstkilde = "pdf" | "docx" | "ocr" | "ingen" | "feil";

export type Uttrekk = {
  tekst: string;
  kilde: Tekstkilde;
  sider: number | null;
  /** Hvorfor det ikke ble (full) tekst — går i `text_error`. */
  merknad: string | null;
};

const OCR_BILDETYPER = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// ---------------------------------------------------------------------------------------
// OCR-verktøy
// ---------------------------------------------------------------------------------------

let ocrStatus: Promise<boolean> | null = null;
/** Språkene tesseract skal bruke — de av nor/eng som faktisk er installert (imaget har nor). */
let ocrSprak = "nor";

/** Finnes tesseract og pdftoppm i imaget? Sjekkes én gang per prosess. */
export function ocrErTilgjengelig(): Promise<boolean> {
  ocrStatus ??= (async () => {
    try {
      const { stdout, stderr } = await kjor("tesseract", ["--list-langs"]);
      const installert = `${stdout}\n${stderr}`.split(/\s+/);
      const valgt = ["nor", "eng"].filter((l) => installert.includes(l));
      if (valgt.length === 0) return false;
      ocrSprak = valgt.join("+");
      await kjor("pdftoppm", ["-v"]);
      return true;
    } catch {
      return false;
    }
  })();
  return ocrStatus;
}

/** Testene: glem cachen når de stubber verktøyene. */
export function glemOcrStatus() {
  ocrStatus = null;
}

async function tesseract(bildeSti: string): Promise<string> {
  const { stdout } = await kjor("tesseract", [bildeSti, "-", "-l", ocrSprak, "--psm", "3"], {
    timeout: OCR_TIDSGRENSE_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function medTmpMappe<T>(fn: (mappe: string) => Promise<T>): Promise<T> {
  const mappe = await mkdtemp(path.join(/* turbopackIgnore: true */ os.tmpdir(), "driftiq-ocr-"));
  try {
    return await fn(mappe);
  } finally {
    await rm(mappe, { recursive: true, force: true }).catch(() => {});
  }
}

/** PDF → PNG per side (200 dpi, gråtoner) → tesseract. Sidene skilles med form feed. */
async function ocrPdf(data: Buffer): Promise<{ tekst: string; sider: number }> {
  return medTmpMappe(async (mappe) => {
    const inn = path.join(/* turbopackIgnore: true */ mappe, "inn.pdf");
    await writeFile(inn, data);
    await kjor("pdftoppm", ["-r", "200", "-gray", "-png", "-l", String(MAKS_OCR_SIDER), inn, path.join(/* turbopackIgnore: true */ mappe, "side")], {
      timeout: OCR_TIDSGRENSE_MS * 2,
    });
    const sider = (await readdir(mappe)).filter((f) => f.startsWith("side") && f.endsWith(".png")).sort();
    const deler: string[] = [];
    for (const s of sider) deler.push(await tesseract(path.join(/* turbopackIgnore: true */ mappe, s)));
    return { tekst: deler.join("\n\f\n"), sider: sider.length };
  });
}

async function ocrBilde(data: Buffer, endelse: string): Promise<string> {
  return medTmpMappe(async (mappe) => {
    const inn = path.join(/* turbopackIgnore: true */ mappe, `bilde${endelse}`);
    await writeFile(inn, data);
    return tesseract(inn);
  });
}

// ---------------------------------------------------------------------------------------
// Uttrekket
// ---------------------------------------------------------------------------------------

/** Rydder mellomrom uten å fjerne linjeskift helt — «Side 3 av 12» skal fortsatt kunne leses. */
export function ryddTekst(t: string): string {
  return t
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+/g, " ") // vanlig, tab og hardt mellomrom
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAKS_TEKST);
}

/**
 * Tekst fra én fil. Kaster aldri for «kan ikke» — det er et resultat (`kilde: "ingen"`,
 * `merknad`), ikke en feil. Kaster bare når selve parsingen velter (ødelagt fil), og da
 * fanger `uttrekkForDokument` det og merker raden.
 */
export async function uttrekkTekst(
  data: Buffer,
  contentType: string,
  opts: { ocr?: boolean; /** Testene: OCR også når tekstlaget er godt nok. */ tvingOcr?: boolean } = {},
): Promise<Uttrekk> {
  const ocrLov = opts.ocr ?? true;

  if (contentType === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const r = await extractText(pdf, { mergePages: true });
    const tekst = ryddTekst(r.text);
    const sider = r.totalPages || 1;
    const perSide = tekst.replace(/\s/g, "").length / sider;
    if (perSide >= SKANNET_TERSKEL_TEGN_PER_SIDE && !opts.tvingOcr) return { tekst, kilde: "pdf", sider, merknad: null };

    // Nesten ingen tekst per side = skannet. OCR hvis vi kan; ellers behold det lille vi fant.
    if (!ocrLov) return { tekst, kilde: tekst ? "pdf" : "ingen", sider, merknad: "Skannet PDF — OCR er skrudd av" };
    if (!(await ocrErTilgjengelig())) {
      return { tekst, kilde: tekst ? "pdf" : "ingen", sider, merknad: "Skannet PDF — OCR-verktøy mangler på serveren" };
    }
    const o = await ocrPdf(data);
    const ocrTekst = ryddTekst(o.tekst);
    if (ocrTekst.length <= tekst.length && !opts.tvingOcr) return { tekst, kilde: tekst ? "pdf" : "ingen", sider, merknad: "Skannet PDF — OCR fant ingen lesbar tekst" };
    return {
      tekst: ocrTekst,
      kilde: "ocr",
      sider,
      merknad: sider > MAKS_OCR_SIDER ? `Bare de første ${MAKS_OCR_SIDER} av ${sider} sidene er OCR-lest` : null,
    };
  }

  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const r = await mammoth.extractRawText({ buffer: data });
    const tekst = ryddTekst(r.value);
    return { tekst, kilde: tekst ? "docx" : "ingen", sider: null, merknad: tekst ? null : "Word-dokumentet inneholder ingen tekst" };
  }

  if (contentType === "application/msword") {
    return { tekst: "", kilde: "ingen", sider: null, merknad: "Gammelt Word-format (.doc) støttes ikke — lagre som .docx eller PDF" };
  }

  if (OCR_BILDETYPER.has(contentType)) {
    if (!ocrLov) return { tekst: "", kilde: "ingen", sider: 1, merknad: "Bilde — OCR er skrudd av" };
    if (!(await ocrErTilgjengelig())) return { tekst: "", kilde: "ingen", sider: 1, merknad: "Bilde — OCR-verktøy mangler på serveren" };
    const tekst = ryddTekst(await ocrBilde(data, contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : contentType === "image/gif" ? ".gif" : ".jpg"));
    return { tekst, kilde: tekst ? "ocr" : "ingen", sider: 1, merknad: tekst ? null : "Bilde — OCR fant ingen lesbar tekst" };
  }

  if (contentType === "image/heic" || contentType === "image/heif") {
    return { tekst: "", kilde: "ingen", sider: 1, merknad: "HEIC-bilder kan ikke OCR-leses — lagre som JPEG" };
  }

  return { tekst: "", kilde: "ingen", sider: null, merknad: `Filtypen ${contentType} har ikke tekst å søke i` };
}

// ---------------------------------------------------------------------------------------
// Per dokument og som jobb
// ---------------------------------------------------------------------------------------

export type Uttrekksresultat = { id: string; kilde: Tekstkilde; tegn: number; sider: number | null; merknad: string | null };

/** Leser fila, trekker ut teksten og skriver den på raden — ett forsøk, uansett utfall. */
export async function uttrekkForDokument(db: Db, orgId: string, dokId: string, naa = new Date()): Promise<Uttrekksresultat> {
  const rader = await db
    .select({ id: documents.id, filename: documents.filename, contentType: documents.contentType })
    .from(documents)
    .where(and(eq(documents.id, dokId), eq(documents.orgId, orgId)))
    .limit(1);
  const d = rader[0];
  if (!d) throw ikkeFunnet("Dokument");

  let resultat: Uttrekk;
  try {
    const data = await readFile(filSti(orgId, "documents", d.filename));
    resultat = await uttrekkTekst(data, d.contentType);
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e);
    resultat = { tekst: "", kilde: "feil", sider: null, merknad: `Kunne ikke lese fila: ${melding.slice(0, 200)}` };
  }

  await db
    .update(documents)
    .set({
      contentText: resultat.tekst || null,
      textSource: resultat.kilde,
      textExtractedAt: naa,
      textError: resultat.merknad,
    })
    .where(and(eq(documents.id, dokId), eq(documents.orgId, orgId)));

  return { id: dokId, kilde: resultat.kilde, tegn: resultat.tekst.length, sider: resultat.sider, merknad: resultat.merknad };
}

/** Åpner for et nytt forsøk — f.eks. etter at OCR-verktøyene kom på plass i imaget. */
export async function nullstillTekst(db: Db, orgId: string, dokId: string) {
  await db
    .update(documents)
    .set({ contentText: null, textSource: null, textExtractedAt: null, textError: null })
    .where(and(eq(documents.id, dokId), eq(documents.orgId, orgId)));
}

/** Dokumenter som ennå ikke er forsøkt — på tvers av orger, til jobben. */
export async function antallVentende(): Promise<number> {
  const r = await withoutRls("bakgrunnsjobb", (db) =>
    db.select({ n: sql<number>`count(*)::int` }).from(documents).where(isNull(documents.textExtractedAt)),
  );
  return r[0]?.n ?? 0;
}

export type Jobbresultat = { behandlet: number; medTekst: number; ocr: number; uten: number; feil: string[] };

/**
 * Jobben: de eldste uforsøkte dokumentene først, hver i sin egen `withOrg` — withoutRls
 * brukes bare til å FINNE dem. Én OCR-tung PDF skal ikke stoppe resten; feil merkes på
 * raden (`uttrekkForDokument` kaster ikke for det) og telles.
 */
export async function kjorTekstuttrekk(opts: { grense?: number; naa?: Date } = {}): Promise<Jobbresultat> {
  const ventende = await withoutRls("bakgrunnsjobb", (db) =>
    db
      .select({ id: documents.id, orgId: documents.orgId })
      .from(documents)
      .where(isNull(documents.textExtractedAt))
      .orderBy(asc(documents.uploadedAt))
      .limit(opts.grense ?? 25),
  );
  const r: Jobbresultat = { behandlet: 0, medTekst: 0, ocr: 0, uten: 0, feil: [] };
  for (const v of ventende) {
    try {
      const u = await withOrg(v.orgId, (db) => uttrekkForDokument(db, v.orgId, v.id, opts.naa));
      r.behandlet++;
      if (u.kilde === "ocr") r.ocr++;
      if (u.tegn > 0) r.medTekst++;
      else r.uten++;
      if (u.kilde === "feil") r.feil.push(`${v.id}: ${u.merknad}`);
    } catch (e) {
      r.feil.push(`${v.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return r;
}
