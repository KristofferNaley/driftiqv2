/**
 * Kontrakter — port av v1s `routers/contracts.py`. Første modul som lagrer filer.
 *
 * Opplastingsreglene her er strengere enn standarden i `lagring.ts`: bare PDF, PNG og JPG,
 * men opptil 25 MB. En skannet avtale er ofte et stort PDF, mens et Word-dokument ikke er
 * en signert avtale.
 */

import { and, asc, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { contractPriceHistory, contracts } from "../db/schema/kontrakter";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet } from "./api";
import { lagreFil, slettFil } from "./lagring";

/** Undersett av `TILLATTE_TYPER`. En avtale er et dokument eller en skann, ikke et regneark. */
export const KONTRAKT_TYPER = ["application/pdf", "image/png", "image/jpeg"] as const;
export const KONTRAKT_MAKS = 25 * 1024 * 1024;

const MODUL = "contracts";

export const kontraktInn = z.object({
  vendorId: z.string().min(1, "Leverandør må velges"),
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  category: z.string().trim().nullish(),
  annualSum: z.number().int().min(0).nullish(),
  startDate: z.string().date().nullish(),
  endDate: z.string().date().nullish(),
  notes: z.string().nullish(),
  contactName: z.string().trim().nullish(),
  contactEmail: z.string().trim().nullish(),
  contactPhone: z.string().trim().nullish(),
  aiReadable: z.boolean().default(false),
  /** Settes kun ved fornyelse — se `endreKontrakt`. */
  predecessorId: z.string().nullish(),
});

export const kontraktEndring = kontraktInn.partial().omit({ predecessorId: true });

export const prisInn = z.object({
  effectiveDate: z.string().date(),
  annualSum: z.number().int().min(0),
  note: z.string().trim().nullish(),
});

export const arkiverInn = z.object({ archiveNote: z.string().trim().nullish() });

async function krevLeverandorIOrg(db: Db, orgId: string, vendorId?: string | null) {
  if (!vendorId) return;
  const r = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.orgId, orgId)))
    .limit(1);
  if (r.length === 0) throw ikkeFunnet("Leverandør");
}

export async function hentKontrakter(db: Db, orgId: string, opts: { arkiverte?: boolean } = {}) {
  const betingelser = [eq(contracts.orgId, orgId)];
  if (opts.arkiverte === true) betingelser.push(isNotNull(contracts.archivedAt));
  if (opts.arkiverte === false) betingelser.push(isNull(contracts.archivedAt));

  const rader = await db
    .select({ kontrakt: contracts, vendorName: vendors.name })
    .from(contracts)
    .leftJoin(vendors, eq(vendors.id, contracts.vendorId))
    .where(and(...betingelser))
    .orderBy(asc(contracts.title));

  return rader.map((r) => ({ ...r.kontrakt, vendorName: r.vendorName }));
}

export async function hentKontrakt(db: Db, orgId: string, contractId: string) {
  // Leverandørnavnet joines inn som i listen — detaljsiden viste «—» uten det.
  const rader = await db
    .select({ kontrakt: contracts, vendorName: vendors.name })
    .from(contracts)
    .leftJoin(vendors, eq(vendors.id, contracts.vendorId))
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .limit(1);
  const rad = rader[0];
  if (!rad) throw ikkeFunnet("Avtale");

  const prishistorikk = await db
    .select()
    .from(contractPriceHistory)
    .where(eq(contractPriceHistory.contractId, contractId))
    .orderBy(desc(contractPriceHistory.effectiveDate));

  return { ...rad.kontrakt, vendorName: rad.vendorName, prishistorikk };
}

export async function opprettKontrakt(db: Db, orgId: string, data: z.infer<typeof kontraktInn>) {
  await krevLeverandorIOrg(db, orgId, data.vendorId);
  if (data.predecessorId) {
    const r = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.id, data.predecessorId), eq(contracts.orgId, orgId)))
      .limit(1);
    if (r.length === 0) throw ikkeFunnet("Avtalen som fornyes");
  }

  const [ny] = await db
    .insert(contracts)
    .values({ id: randomUUID(), orgId, ...data })
    .returning();
  return ny!;
}

/**
 * `predecessorId` kan IKKE endres her — den settes bare ved opprettelse av en fornyelse.
 * Uten unntaket ville hver vanlig lagring nullet ut koblingen til avtalen som ble erstattet,
 * fordi feltet ikke er med i redigeringsskjemaet.
 */
export async function endreKontrakt(
  db: Db,
  orgId: string,
  contractId: string,
  data: z.infer<typeof kontraktEndring>,
) {
  await hentKontrakt(db, orgId, contractId);
  await krevLeverandorIOrg(db, orgId, data.vendorId);

  const [endret] = await db
    .update(contracts)
    .set(data)
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .returning();
  return endret!;
}

export async function arkiverKontrakt(
  db: Db,
  orgId: string,
  contractId: string,
  data: z.infer<typeof arkiverInn>,
) {
  await hentKontrakt(db, orgId, contractId);
  const [arkivert] = await db
    .update(contracts)
    .set({ archivedAt: sql`now()`, archiveNote: data.archiveNote ?? null })
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .returning();
  return arkivert!;
}

/**
 * Sletting er for feilregistreringer — en avtale som ER avsluttet skal arkiveres, ikke
 * slettes, fordi den har verdi som historikk. Prishistorikken ryker med raden (cascade);
 * fila slettes ETTER raden, samme rekkefølge som `slettDokument` og av samme grunn.
 */
export async function slettKontrakt(db: Db, orgId: string, contractId: string) {
  const kontrakt = await hentKontrakt(db, orgId, contractId);
  await db.delete(contracts).where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)));
  if (kontrakt.fileName) await slettFil(orgId, MODUL, kontrakt.fileName);
}

export async function gjenopprettKontrakt(db: Db, orgId: string, contractId: string) {
  await hentKontrakt(db, orgId, contractId);
  const [tilbake] = await db
    .update(contracts)
    .set({ archivedAt: null, archiveNote: null })
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .returning();
  return tilbake!;
}

// ---------------------------------------------------------------------------------------
// Avtaledokumentet
// ---------------------------------------------------------------------------------------

/**
 * Laster opp eller erstatter avtaledokumentet.
 *
 * Erstatter den en eksisterende fil, teller bare DIFFERANSEN mot kvoten — ellers kunne en
 * kunde på taket aldri byttet ut et vedlegg med et like stort. Den gamle fila slettes først
 * etter at den nye er skrevet: ryker skrivingen, står den gamle igjen.
 */
export async function lastOppDokument(db: Db, orgId: string, contractId: string, fil: File) {
  const kontrakt = await hentKontrakt(db, orgId, contractId);

  const opplasting = await lagreFil(db, orgId, MODUL, fil, {
    typer: KONTRAKT_TYPER,
    maksStorrelse: KONTRAKT_MAKS,
    erstatter: kontrakt.fileSize,
  });

  const [endret] = await db
    .update(contracts)
    .set({
      fileName: opplasting.filnavn,
      fileOriginalName: opplasting.originalnavn,
      fileSize: opplasting.storrelse,
    })
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .returning();

  if (kontrakt.fileName) await slettFil(orgId, MODUL, kontrakt.fileName);
  return endret!;
}

export async function slettDokument(db: Db, orgId: string, contractId: string) {
  const kontrakt = await hentKontrakt(db, orgId, contractId);
  if (!kontrakt.fileName) throw ikkeFunnet("Fil");

  // Raden ryddes FØR disken: en rad som peker på en fil som ikke finnes er verre enn en
  // fil uten rad, siden den første gir 404 til brukeren og den andre bare bruker plass.
  const [endret] = await db
    .update(contracts)
    .set({ fileName: null, fileOriginalName: null, fileSize: null })
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)))
    .returning();

  await slettFil(orgId, MODUL, kontrakt.fileName);
  return endret!;
}

// ---------------------------------------------------------------------------------------
// Prishistorikk
// ---------------------------------------------------------------------------------------

export async function leggTilPris(
  db: Db,
  orgId: string,
  contractId: string,
  data: z.infer<typeof prisInn>,
) {
  await hentKontrakt(db, orgId, contractId);
  const [ny] = await db
    .insert(contractPriceHistory)
    .values({ id: randomUUID(), contractId, ...data })
    .returning();

  // Nyeste pris er avtalens gjeldende årssum. Å la kunden vedlikeholde begge ville betydd
  // to tall som sier ulike ting om samme avtale.
  const nyeste = await db
    .select({ annualSum: contractPriceHistory.annualSum })
    .from(contractPriceHistory)
    .where(eq(contractPriceHistory.contractId, contractId))
    .orderBy(desc(contractPriceHistory.effectiveDate))
    .limit(1);
  await db
    .update(contracts)
    .set({ annualSum: nyeste[0]?.annualSum ?? null })
    .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)));

  return ny!;
}

export async function slettPris(db: Db, orgId: string, contractId: string, entryId: string) {
  await hentKontrakt(db, orgId, contractId);
  const r = await db
    .select({ id: contractPriceHistory.id })
    .from(contractPriceHistory)
    .where(and(eq(contractPriceHistory.id, entryId), eq(contractPriceHistory.contractId, contractId)))
    .limit(1);
  if (r.length === 0) throw ikkeFunnet("Prisoppføring");

  await db.delete(contractPriceHistory).where(eq(contractPriceHistory.id, entryId));

  // Årssummen følger nyeste gjenværende pris — samme regel som `leggTilPris`. Var det den
  // nyeste som ble slettet, ville summen ellers blitt stående på den. Uten gjenværende
  // oppføringer røres ikke summen: den kan være satt direkte på avtalen, uten historikk.
  const nyeste = await db
    .select({ annualSum: contractPriceHistory.annualSum })
    .from(contractPriceHistory)
    .where(eq(contractPriceHistory.contractId, contractId))
    .orderBy(desc(contractPriceHistory.effectiveDate))
    .limit(1);
  if (nyeste[0]) {
    await db
      .update(contracts)
      .set({ annualSum: nyeste[0].annualSum })
      .where(and(eq(contracts.id, contractId), eq(contracts.orgId, orgId)));
  }
}

/** Avtaler som har utløpt og ennå ikke er arkivert — «åpen til den lukkes». */
export async function utlopteAvtaler(db: Db, orgId: string) {
  const iDag = new Date().toISOString().slice(0, 10);
  return db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.orgId, orgId),
        isNull(contracts.archivedAt),
        isNotNull(contracts.endDate),
        sql`${contracts.endDate} < ${iDag}`,
      ),
    )
    .orderBy(asc(contracts.endDate));
}
