/**
 * Dokumentarkiv — port av v1s `routers/documents.py`.
 *
 * ## «Slug eller id»
 *
 * En mappenøkkel er ENTEN en av de seks faste slugene ELLER id-en til en mappe kunden har
 * laget selv. Det gjør at egne mapper kan ligge inne i standardmappene uten en egen
 * koblingstabell — men det betyr også at verken `documents.folder` eller
 * `documentFolders.parentId` er fremmednøkler. Sletting må derfor rydde eksplisitt:
 * dokumentene flyttes til «Annet», undertreet slettes for hånd.
 */

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { documentFolders, documents } from "../db/schema/dokumenter";
import { elementDocuments } from "../db/schema/vedlikehold";
import { contracts } from "../db/schema/kontrakter";
import { ikkeFunnet, ugyldig } from "./api";
import type { Aktor } from "./aktor";
import { loggHendelse } from "./hendelser";
import { lagreFil, lagringsstatus, slettFil } from "./lagring";

const MODUL = "documents";

/** Faste mapper. Rekkefølgen styrer visningen. Kan ikke endres eller slettes av kunden. */
export const FASTE_MAPPER = [
  "vedtekter",
  "generalforsamling",
  "styrereferater",
  "bygningsdok",
  "forsikring",
  "annet",
] as const;

/** Dit dokumentene flyttes når en egen mappe slettes. */
export const FALLBACK_MAPPE = "annet";

/**
 * Mapper som sorteres automatisk på år (utledet av `documentDate`) i stedet for manuelle
 * undermapper. Å tillate begge deler ville gitt to konkurrerende ordninger i samme mappe.
 */
export const AARSGRUPPERTE = ["styrereferater"];

/** Hindrer at brødsmulesti og mappevelger blir uleselige. Toppnivå = 1. */
export const MAKS_DYBDE = 3;

export const mappeInn = z.object({
  name: z.string().trim().min(1, "Mappenavn må fylles ut"),
  icon: z.string().trim().default("📁"),
  parentId: z.string().nullish(),
});

export const mappeEndring = mappeInn.partial();

export const dokumentEndring = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut").optional(),
  description: z.string().nullish(),
  folder: z.string().optional(),
  documentDate: z.string().date().nullish(),
  aiReadable: z.boolean().optional(),
});

export const dokumentInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  folder: z.string().default(FALLBACK_MAPPE),
  documentDate: z.string().date().nullish(),
  aiReadable: z.boolean().default(false),
});

// ---------------------------------------------------------------------------------------
// Mappetreet
// ---------------------------------------------------------------------------------------

function erFastMappe(nokkel: string): boolean {
  return (FASTE_MAPPER as readonly string[]).includes(nokkel);
}

async function hentMappe(db: Db, orgId: string, folderId: string) {
  const rader = await db
    .select()
    .from(documentFolders)
    .where(and(eq(documentFolders.id, folderId), eq(documentFolders.orgId, orgId)))
    .limit(1);
  const mappe = rader[0];
  if (!mappe) throw ikkeFunnet("Mappe");
  return mappe;
}

/**
 * Nivået til en mappe angitt ved nøkkel. Toppnivå = 1, null = 0.
 * En standardmappe er alltid nivå 1 og kan ikke ha forelder.
 *
 * `sett` bryter en eventuell sykel i dataene — uten den ville en ødelagt `parentId`-kjede
 * gitt en uendelig løkke i stedet for et galt tall.
 */
async function dybde(db: Db, orgId: string, nokkel: string | null): Promise<number> {
  let n = 0;
  const sett = new Set<string>();
  let key = nokkel;
  while (key !== null && key !== undefined && !sett.has(key)) {
    sett.add(key);
    n += 1;
    if (erFastMappe(key)) break;
    const rader = await db
      .select({ parentId: documentFolders.parentId })
      .from(documentFolders)
      .where(and(eq(documentFolders.id, key), eq(documentFolders.orgId, orgId)))
      .limit(1);
    if (!rader[0]) break;
    key = rader[0].parentId;
  }
  return n;
}

/** Mappa selv og alle etterkommere. Brukes til sletting og sykelsjekk. */
async function etterkommere(db: Db, orgId: string, folderId: string): Promise<string[]> {
  const ids = [folderId];
  let frontier = [folderId];
  while (frontier.length > 0) {
    const barn = await db
      .select({ id: documentFolders.id })
      .from(documentFolders)
      .where(and(eq(documentFolders.orgId, orgId), inArray(documentFolders.parentId, frontier)));
    frontier = barn.map((b) => b.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

/**
 * Foreldremappa må finnes, ikke lage sykel, og ikke sprenge dybdegrensen.
 * `flytter` settes når en EKSISTERENDE mappe flyttes — da må sykelsjekken kjøre.
 */
async function validerForelder(
  db: Db,
  orgId: string,
  parentId: string | null | undefined,
  flytter?: string,
): Promise<void> {
  if (parentId === null || parentId === undefined) return;

  if (AARSGRUPPERTE.includes(parentId)) {
    throw ugyldig("Denne mappen sorteres automatisk på år og kan ikke ha egne undermapper");
  }
  if (!erFastMappe(parentId)) {
    await hentMappe(db, orgId, parentId); // egen mappe — må finnes i samme org
    if (flytter) {
      // En mappe kan ikke bli sitt eget opphav — det ville koblet undertreet fra arkivet.
      const under = await etterkommere(db, orgId, flytter);
      if (under.includes(parentId)) {
        throw ugyldig("En mappe kan ikke flyttes inn i seg selv eller en av sine egne undermapper");
      }
    }
  }
  if ((await dybde(db, orgId, parentId)) >= MAKS_DYBDE) {
    throw ugyldig(`Maks ${MAKS_DYBDE} nivåer med mapper`);
  }
}

/** Gyldig mappe = en fast slug eller en av kundens egne mapper. */
async function mappeFinnes(db: Db, orgId: string, nokkel: string): Promise<boolean> {
  if (erFastMappe(nokkel)) return true;
  const rader = await db
    .select({ id: documentFolders.id })
    .from(documentFolders)
    .where(and(eq(documentFolders.id, nokkel), eq(documentFolders.orgId, orgId)))
    .limit(1);
  return rader.length > 0;
}

export async function hentMapper(db: Db, orgId: string) {
  return db
    .select()
    .from(documentFolders)
    .where(eq(documentFolders.orgId, orgId))
    .orderBy(asc(documentFolders.name));
}

export async function opprettMappe(db: Db, orgId: string, data: z.infer<typeof mappeInn>) {
  await validerForelder(db, orgId, data.parentId);
  const [ny] = await db
    .insert(documentFolders)
    .values({ id: randomUUID(), orgId, ...data, parentId: data.parentId ?? null })
    .returning();
  return ny!;
}

export async function endreMappe(
  db: Db,
  orgId: string,
  folderId: string,
  data: z.infer<typeof mappeEndring>,
) {
  await hentMappe(db, orgId, folderId);
  if (data.parentId !== undefined) {
    await validerForelder(db, orgId, data.parentId, folderId);
  }
  const [endret] = await db
    .update(documentFolders)
    .set(data)
    .where(and(eq(documentFolders.id, folderId), eq(documentFolders.orgId, orgId)))
    .returning();
  return endret!;
}

/**
 * Sletter mappa og alle undermapper. **Dokumentene går ikke tapt** — de flyttes til «Annet».
 *
 * Både flyttingen og sletting av undertreet må gjøres eksplisitt: verken `documents.folder`
 * eller `documentFolders.parentId` er fremmednøkler, siden de rommer slug ELLER id.
 */
export async function slettMappe(db: Db, orgId: string, folderId: string, av: Aktor) {
  const mappe = await hentMappe(db, orgId, folderId);
  const ids = await etterkommere(db, orgId, folderId);

  await loggHendelse(db, orgId, av, {
    modul: "dokumentarkiv",
    entitet: "mappe",
    entitetId: folderId,
    hendelse: `Slettet mappen «${mappe.name}» — dokumentene ble flyttet til «Annet»`,
  });

  const flyttet = await db
    .update(documents)
    .set({ folder: FALLBACK_MAPPE })
    .where(and(eq(documents.orgId, orgId), inArray(documents.folder, ids)))
    .returning({ id: documents.id });

  await db
    .delete(documentFolders)
    .where(and(eq(documentFolders.orgId, orgId), inArray(documentFolders.id, ids)));

  return { flyttedeDokumenter: flyttet.length, slettedeMapper: ids.length };
}

// ---------------------------------------------------------------------------------------
// Dokumenter
// ---------------------------------------------------------------------------------------

export async function hentDokumenter(db: Db, orgId: string, mappe?: string) {
  const betingelser = [eq(documents.orgId, orgId)];
  if (mappe) betingelser.push(eq(documents.folder, mappe));
  return db
    .select()
    .from(documents)
    .where(and(...betingelser))
    .orderBy(sql`${documents.documentDate} DESC NULLS LAST`, asc(documents.title));
}

export async function hentDokument(db: Db, orgId: string, docId: string) {
  const rader = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.orgId, orgId)))
    .limit(1);
  const dok = rader[0];
  if (!dok) throw ikkeFunnet("Dokument");
  return dok;
}

export async function lastOppDokument(
  db: Db,
  orgId: string,
  lastetOppAv: string,
  fil: File,
  data: z.infer<typeof dokumentInn>,
) {
  if (!(await mappeFinnes(db, orgId, data.folder))) throw ikkeFunnet("Mappe");

  const opplasting = await lagreFil(db, orgId, MODUL, fil);
  const [ny] = await db
    .insert(documents)
    .values({
      id: randomUUID(),
      orgId,
      ...data,
      filename: opplasting.filnavn,
      originalName: opplasting.originalnavn,
      contentType: opplasting.contentType,
      fileSize: opplasting.storrelse,
      uploadedBy: lastetOppAv,
    })
    .returning();
  return ny!;
}

export async function endreDokument(
  db: Db,
  orgId: string,
  docId: string,
  data: z.infer<typeof dokumentEndring>,
) {
  await hentDokument(db, orgId, docId);
  if (data.folder && !(await mappeFinnes(db, orgId, data.folder))) throw ikkeFunnet("Mappe");

  const [endret] = await db
    .update(documents)
    .set(data)
    .where(and(eq(documents.id, docId), eq(documents.orgId, orgId)))
    .returning();
  return endret!;
}

export async function slettDokument(db: Db, orgId: string, docId: string, av: Aktor) {
  const dok = await hentDokument(db, orgId, docId);
  await loggHendelse(db, orgId, av, {
    modul: "dokumentarkiv",
    entitet: "dokument",
    entitetId: docId,
    hendelse: `Slettet «${dok.title}» (${dok.originalName})`,
  });
  // Raden først, disken etterpå — samme resonnement som i Kontrakter.
  await db.delete(documents).where(and(eq(documents.id, docId), eq(documents.orgId, orgId)));
  await slettFil(orgId, MODUL, dok.filename);
}

/** Dokumenter gruppert på år, for mappene som sorteres slik. */
export function grupperPaAar(dokumenter: Array<{ documentDate: string | null }>) {
  const grupper = new Map<string, number>();
  for (const d of dokumenter) {
    const aar = d.documentDate?.slice(0, 4) ?? "Uten dato";
    grupper.set(aar, (grupper.get(aar) ?? 0) + 1);
  }
  return grupper;
}

// ---------------------------------------------------------------------------------------
// Arkivoversikten
// ---------------------------------------------------------------------------------------

/**
 * Anbefalt innhold. Hvert punkt sjekker bare om en mappe HAR noe i seg.
 *
 * Det er alt vi ærlig kan utlede. Vi kan ikke vite om en bestemt PDF faktisk er
 * som-bygget-tegninger, og lista skal ikke påstå mer enn den vet — den er en huskeliste,
 * ikke en godkjenning.
 */
export const ANBEFALT: ReadonlyArray<{ mappe: string; tittel: string; hint?: string }> = [
  { mappe: "vedtekter", tittel: "Gjeldende vedtekter", hint: "Signert og datert versjon" },
  { mappe: "generalforsamling", tittel: "Siste generalforsamlingsprotokoll" },
  { mappe: "styrereferater", tittel: "Styrereferater", hint: "Referat fra styremøtene" },
  {
    mappe: "bygningsdok",
    tittel: "Bygningsdokumentasjon",
    hint: "Tegninger og tilsynsrapporter. FDV per anlegg ligger i Vedlikehold-mappa.",
  },
  { mappe: "forsikring", tittel: "Gjeldende forsikringsavtale" },
];

/**
 * Alt forsiden i arkivet trenger: mapper med tellinger, speilmappene, anbefalt innhold,
 * lagringsstatus og de sist opplastede.
 *
 * ## Speilmappene
 *
 * FDV-filene eies av Vedlikehold og kontraktfilene av Kontrakter. De vises HER fordi det er
 * her folk leter etter «forsikringsavtalen» eller «FDV-en på taket» — men de kopieres ikke.
 * Kortene teller bare, og opplasting og sletting skjer i modulen som eier filene. To steder
 * å laste opp samme fil ville gitt to sannheter om hvilken versjon som gjelder.
 */
export async function hentArkivoversikt(db: Db, orgId: string) {
  const [alle, egne, lagring, fdv, kontraktfiler] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        folder: documents.folder,
        fileSize: documents.fileSize,
        originalName: documents.originalName,
        contentType: documents.contentType,
        documentDate: documents.documentDate,
        uploadedAt: documents.uploadedAt,
      })
      .from(documents)
      .where(eq(documents.orgId, orgId)),
    hentMapper(db, orgId),
    lagringsstatus(db, orgId),
    // Speil: FDV per anlegg.
    db
      .select({ elementId: elementDocuments.elementId })
      .from(elementDocuments)
      .where(eq(elementDocuments.orgId, orgId)),
    // Speil: kontrakter med fil. `fileName` er null når ingen fil er lastet opp.
    db
      .select({ vendorId: contracts.vendorId })
      .from(contracts)
      .where(and(eq(contracts.orgId, orgId), isNotNull(contracts.fileName))),
  ]);

  const perMappe = new Map<string, number>();
  for (const d of alle) perMappe.set(d.folder, (perMappe.get(d.folder) ?? 0) + 1);

  const undermapper = new Map<string, number>();
  for (const m of egne) {
    if (m.parentId) undermapper.set(m.parentId, (undermapper.get(m.parentId) ?? 0) + 1);
  }

  return {
    faste: FASTE_MAPPER.map((n) => ({
      nokkel: n,
      antall: perMappe.get(n) ?? 0,
      antallUndermapper: undermapper.get(n) ?? 0,
    })),
    // Bare toppnivå på forsiden — undermapper vises når man går inn i forelderen.
    egne: egne
      .filter((m) => !m.parentId)
      .map((m) => ({
        ...m,
        antall: perMappe.get(m.id) ?? 0,
        antallUndermapper: undermapper.get(m.id) ?? 0,
      })),
    speil: {
      vedlikehold: { antall: fdv.length, antallDeler: new Set(fdv.map((r) => r.elementId)).size },
      kontrakter: {
        antall: kontraktfiler.length,
        antallLeverandorer: new Set(kontraktfiler.map((r) => r.vendorId)).size,
      },
    },
    anbefalt: ANBEFALT.map((a) => ({ ...a, ok: (perMappe.get(a.mappe) ?? 0) > 0 })),
    lagring,
    /** De ti sist opplastede, på tvers av mapper — «hvor ble det av den jeg lastet opp?». */
    nylig: [...alle]
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, 10),
    antallTotalt: alle.length,
  };
}
