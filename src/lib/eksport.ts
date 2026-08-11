/**
 * «Eksport og backup» — hele kundens data i én ZIP. Port av v1s `/export/zip`.
 *
 * ## Tabellista er RLS-registeret, ikke en håndskrevet liste
 *
 * v1 vedlikeholdt en egen modell-liste i eksporten, med en kommentar om at den måtte holdes
 * i takt med tenanttabellene. Her LESES tenantregisteret (`DIREKTE_TABELLER` +
 * `BARNETABELLER` i db/rls/tables.ts) direkte: en ny modul som får RLS-dekning blir med i
 * eksporten av seg selv. Eksporten lover «alle data», og et backup-uttak som stille mangler
 * en modul er verre enn ingen eksport.
 *
 * Spørringene kjøres i org-kontekst (`withOrg`), så RLS-policyene gjør avgrensningen — også
 * for barnetabellene uten egen org_id. Ingen håndskrevne WHERE-ledd å glemme.
 *
 * ## Utenfor med vilje
 *
 * AI-samtalene (brukerens egne, ikke lagets driftsdata), intern målebruk, DriftIQs
 * supportkø, og Unloc-tabellene (API-hemmeligheter og delte digitale nøkler — de tilhører
 * integrasjonen, ikke arkivet). Interne disknavn og tokens strippes fra radene; de
 * opprinnelige filnavnene beholdes så rader og filer kan kobles.
 *
 * ## Filene
 *
 * Disken er fasit: alt under `uploads/orgs/<org>/` pakkes med, også filer en fremtidig
 * modul lagrer uten at dette biblioteket kjenner den. Metadataene brukes bare til å gi
 * filene LESBARE navn og mapper — en fil uten kjent rad beholder uuid-navnet sitt i stedet
 * for å utebli.
 *
 * ZIP-en bygges i minnet. Kvoten (5 GB standard) gjør det teoretisk mulig å sprenge det;
 * i praksis er uttakene små, og den dagen en kunde nærmer seg kvoten er strømming til
 * midlertidig fil (som v1) oppgraderingen.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import JSZip from "jszip";
import type { Db } from "../db/client";
import { BARNETABELLER, DIREKTE_TABELLER } from "../db/rls/tables";
import { hentOrg } from "./organisasjon";
import { orgSti } from "./lagring";

const EKSKLUDERTE_TABELLER = new Set([
  "ai_conversations",
  "ai_usage_daily",
  "feedback_reports",
  "unloc_settings",
  "vendor_unloc_keys",
]);

/** Interne disknavn og tokens — har ingenting i et kundeuttak å gjøre. */
const EKSKLUDERTE_KOLONNER = new Set(["org_id", "qr_token", "filename", "file_name"]);

/** Tegn som ikke kan stå i filnavn på Windows — uttaket skal kunne pakkes ut overalt. */
function trygtNavn(navn: string): string {
  // Kontrolltegnene er nettopp poenget med uttrykket — derfor unntaket fra no-control-regex.
  // eslint-disable-next-line no-control-regex
  return navn.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim() || "uten-navn";
}

function strippRad(rad: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(rad).filter(([k]) => !EKSKLUDERTE_KOLONNER.has(k)));
}

/**
 * Lesbare stier i ZIP-en: `<modul>/<diskNavn>` → sti med opprinnelig filnavn.
 * Bygges fra metadatatabellene; spørringene kjører i org-kontekst som resten.
 */
async function byggNavnekart(db: Db, orgId: string): Promise<Map<string, string>> {
  const kart = new Map<string, string>();
  const rows = async (q: string) => (await db.execute(sql.raw(q))).rows as Record<string, string | null>[];

  for (const r of await rows(
    "SELECT d.filename, d.original_name, d.folder, f.name AS mappenavn FROM documents d LEFT JOIN document_folders f ON f.id = d.folder",
  )) {
    kart.set(`documents/${r.filename}`, `dokumentarkiv/${trygtNavn(r.mappenavn ?? r.folder ?? "annet")}/${trygtNavn(r.original_name ?? r.filename!)}`);
  }
  for (const r of await rows(
    "SELECT c.file_name, c.file_original_name, v.name AS leverandor FROM contracts c LEFT JOIN vendors v ON v.id = c.vendor_id WHERE c.file_name IS NOT NULL",
  )) {
    kart.set(`contracts/${r.file_name}`, `kontrakter/${trygtNavn(r.leverandor ?? "ukjent-leverandor")}/${trygtNavn(r.file_original_name ?? r.file_name!)}`);
  }
  for (const r of await rows(
    "SELECT a.filename, a.original_name, d.number FROM deviation_attachments a JOIN deviations d ON d.id = a.deviation_id",
  )) {
    kart.set(`deviations/${r.filename}`, `avvik/avvik-${r.number}/${trygtNavn(r.original_name ?? r.filename!)}`);
  }
  for (const r of await rows("SELECT filename, original_name FROM completion_photos")) {
    kart.set(`completion_photos/${r.filename}`, `utkvitteringer/${trygtNavn(r.original_name ?? r.filename!)}`);
  }
  for (const r of await rows(
    "SELECT e.filename, e.original_name, b.name AS element FROM element_documents e LEFT JOIN building_elements b ON b.id = e.element_id",
  )) {
    kart.set(`element_documents/${r.filename}`, `vedlikehold/${trygtNavn(r.element ?? "annet")}/${trygtNavn(r.original_name ?? r.filename!)}`);
  }
  for (const r of await rows("SELECT filename, original_name FROM unit_work_documents")) {
    kart.set(`unit_work_documents/${r.filename}`, `enhetsarbeid/${trygtNavn(r.original_name ?? r.filename!)}`);
  }

  const org = await hentOrg(db, orgId);
  if (org.bannerFileName) {
    kart.set(`org/${org.bannerFileName}`, `profil/${trygtNavn(org.bannerOriginalName ?? org.bannerFileName)}`);
  }
  return kart;
}

export async function byggEksport(db: Db, orgId: string) {
  const org = await hentOrg(db, orgId);
  const dato = new Date().toISOString().slice(0, 10);

  // --- data.json: alle tenanttabellene, filtrert av RLS ------------------------------------
  const tabeller = [...DIREKTE_TABELLER, ...Object.keys(BARNETABELLER)]
    .filter((t) => !EKSKLUDERTE_TABELLER.has(t))
    .sort();
  const data: Record<string, unknown> = {
    eksportversjon: 1,
    generert: new Date().toISOString(),
    organisasjon: { navn: org.name, orgNr: org.orgNr, slug: org.slug },
  };
  for (const tabell of tabeller) {
    // Navnene kommer fra vårt eget register, aldri fra brukeren — sql.raw er trygg her.
    const res = await db.execute(sql.raw(`SELECT * FROM "${tabell}"`));
    data[tabell] = (res.rows as Record<string, unknown>[]).map(strippRad);
  }

  // --- filene: disken er fasit, metadataene gir lesbare navn -------------------------------
  const zip = new JSZip();
  const navnekart = await byggNavnekart(db, orgId);
  const brukteStier = new Set<string>();
  const rot = orgSti(orgId);
  let antallFiler = 0;

  // Ingen filer lastet opp ennå = tomme lister; eksporten består da av data.json alene.
  const lesKatalog = (sti: string) => readdir(sti).catch(() => [] as string[]);

  for (const modul of await lesKatalog(rot)) {
    const filer = await lesKatalog(path.join(/* turbopackIgnore: true */ rot, modul));
    for (const fil of filer) {
      let sti = navnekart.get(`${modul}/${fil}`) ?? `${modul}/${fil}`;
      // To «Avtale.pdf» i samme mappe: nummerer den andre i stedet for å overskrive.
      for (let n = 2; brukteStier.has(sti); n++) {
        const p = navnekart.get(`${modul}/${fil}`) ?? `${modul}/${fil}`;
        const punkt = p.lastIndexOf(".");
        sti = punkt > p.lastIndexOf("/") ? `${p.slice(0, punkt)} (${n})${p.slice(punkt)}` : `${p} (${n})`;
      }
      brukteStier.add(sti);
      zip.file(sti, await readFile(path.join(/* turbopackIgnore: true */ rot, modul, fil)));
      antallFiler++;
    }
  }

  const lesmeg = [
    `DriftIQ — komplett dataeksport for ${org.name}`,
    `Generert: ${dato}`,
    "",
    "data.json         Alle registrerte data, én nøkkel per tabell (oppgaver, avvik, kontrakter, HMS, …)",
    "dokumentarkiv/    Dokumentarkivet, i samme mapper som i appen",
    "kontrakter/       Avtaledokumenter, per leverandør",
    "avvik/            Vedlegg, per avvik (nummerert som i appen)",
    "utkvitteringer/   Bilder fra utførte oppgaver",
    "vedlikehold/      FDV-dokumentasjon, per bygningsdel",
    "enhetsarbeid/     Dokumentasjon på arbeid i enkeltenheter",
    "profil/           Dashbordbanneret",
    "",
    `Antall filer: ${antallFiler}`,
    "",
    "AI-samtaler og DriftIQs egen supportkø er ikke med — de er ikke lagets driftsdata.",
  ].join("\n");

  zip.file("LES-MEG.txt", lesmeg);
  zip.file("data.json", JSON.stringify(data, null, 2));

  return {
    innhold: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    navn: `${org.slug}-eksport-${dato}.zip`,
    contentType: "application/zip",
  };
}
