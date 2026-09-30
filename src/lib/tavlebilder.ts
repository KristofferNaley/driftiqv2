/**
 * Bilder og PDF til oppslagstavla: alt som lastes opp, blir WebP-bilder før det lagres.
 *
 * - **Bilder** (JPG, PNG, WebP, HEIC fra iPhone) gjøres om til WebP og skaleres ned til
 *   `MAKS_KANT` på lengste side, med `vips` fra imaget (Dockerfile). `vips thumbnail` retter
 *   også opp bilder som er tatt på høykant (EXIF-rotasjon).
 * - **PDF** deles i ett bilde per side med `pdftoppm` (poppler, samme som tekstuttrekket),
 *   og hver side går samme vei til WebP. PDF-en selv lagres ikke.
 *
 * Skjermen i oppgangen trenger da bare å vise bilder — en TV-nettleser skal verken tegne PDF
 * eller lese HEIC. Verktøyene kjøres som prosesser, ikke som npm-pakker: `sharp` sine
 * ferdigbygde binærer leser ikke HEIC (se docs/beslutninger.md 30.09.2026).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ApiFeil, ugyldig } from "./api";
import { MAKS_KANT, MAKS_SIDER, filFeil, opplastingstype, type Tilpasning } from "./oppslagstavleregler";

const kjor = promisify(execFile);

/** Sidene fra en PDF rastreres til denne kanten før de blir WebP. Lysbilder trenger ikke 4K. */
const PDF_KANT = 2560;
const TIDSGRENSE_MS = 90_000;

export type Sidebilde = { data: Buffer; bredde: number | null; hoyde: number | null; tilpasning: Tilpasning };

async function medTmpMappe<T>(fn: (mappe: string) => Promise<T>): Promise<T> {
  const mappe = await mkdtemp(path.join(/* turbopackIgnore: true */ os.tmpdir(), "driftiq-tavlebilder-"));
  try {
    return await fn(mappe);
  } finally {
    await rm(mappe, { recursive: true, force: true }).catch(() => {});
  }
}

const mangler = (e: unknown) => (e as { code?: string } | null)?.code === "ENOENT";
const UTEN_VERKTOY = "Serveren kan ikke behandle bilder akkurat nå.";

/** Én bildefil på disk → WebP, maks `MAKS_KANT` på lengste side (aldri oppskalert). */
async function tilWebp(inn: string, ut: string): Promise<{ data: Buffer; bredde: number | null; hoyde: number | null }> {
  try {
    await kjor("vips", ["thumbnail", inn, `${ut}[Q=82]`, String(MAKS_KANT), "--height", String(MAKS_KANT), "--size", "down"], {
      timeout: TIDSGRENSE_MS,
    });
  } catch (e) {
    if (mangler(e)) throw new ApiFeil(503, UTEN_VERKTOY);
    throw ugyldig("Kunne ikke lese bildet. Er fila skadet?");
  }
  const maal = async (felt: string) => {
    try {
      return Number((await kjor("vipsheader", ["-f", felt, ut], { timeout: 10_000 })).stdout.trim()) || null;
    } catch {
      return null;
    }
  };
  return { data: await readFile(ut), bredde: await maal("width"), hoyde: await maal("height") };
}

async function pdfSider(inn: string): Promise<number> {
  try {
    const { stdout } = await kjor("pdfinfo", [inn], { timeout: 20_000 });
    return Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
  } catch (e) {
    if (mangler(e)) throw new ApiFeil(503, UTEN_VERKTOY);
    throw ugyldig("Kunne ikke lese PDF-en. Er den passordbeskyttet eller skadet?");
  }
}

/**
 * Sidene én opplastet fil blir til: ett bilde for en bildefil, ett per side for en PDF.
 * `ledig` er hvor mange sider oppslaget har plass til — en PDF med flere sider avvises HEL,
 * med antallet som får plass, i stedet for å bli kuttet stille.
 */
export async function sidebilderFraFil(fil: File, ledig: number): Promise<Sidebilde[]> {
  const feil = filFeil(fil);
  if (feil) throw ugyldig(feil);
  const type = opplastingstype(fil)!;
  const data = Buffer.from(await fil.arrayBuffer());
  if (ledig < 1) throw ugyldig(`Oppslaget er fullt. Et oppslag kan ha ${MAKS_SIDER} bilder.`);

  return medTmpMappe(async (mappe) => {
    const sti = (navn: string) => path.join(/* turbopackIgnore: true */ mappe, navn);
    const inn = sti(`inn.${type}`);
    await writeFile(inn, data);
    if (type !== "pdf") return [{ ...(await tilWebp(inn, sti("ut.webp"))), tilpasning: "dekk" as const }];

    if (data.subarray(0, 5).toString("latin1") !== "%PDF-") throw ugyldig("Filen er ikke en gyldig PDF.");
    const sider = await pdfSider(inn);
    if (sider < 1) throw ugyldig("PDF-en har ingen sider.");
    if (sider > ledig) {
      throw ugyldig(
        ledig === MAKS_SIDER
          ? `PDF-en har ${sider} sider. Et oppslag kan ha ${MAKS_SIDER} bilder.`
          : `PDF-en har ${sider} sider, men det er bare plass til ${ledig} til. Et oppslag kan ha ${MAKS_SIDER} bilder.`,
      );
    }
    try {
      await kjor("pdftoppm", ["-png", "-scale-to", String(PDF_KANT), "-l", String(sider), inn, sti("side")], { timeout: TIDSGRENSE_MS });
    } catch (e) {
      if (mangler(e)) throw new ApiFeil(503, UTEN_VERKTOY);
      throw ugyldig("Kunne ikke gjøre PDF-en om til bilder.");
    }
    // pdftoppm nummererer med ledende nuller etter antall sider (side-01.png), så navnene sorterer riktig.
    const filer = (await readdir(mappe)).filter((f) => f.startsWith("side") && f.endsWith(".png")).sort();
    if (filer.length !== sider) throw ugyldig("Kunne ikke gjøre PDF-en om til bilder.");
    const ut: Sidebilde[] = [];
    // Et lysbilde skal vises helt, ikke beskjæres som et foto.
    for (const [n, f] of filer.entries()) ut.push({ ...(await tilWebp(sti(f), sti(`ut-${n}.webp`))), tilpasning: "hele" });
    return ut;
  });
}
