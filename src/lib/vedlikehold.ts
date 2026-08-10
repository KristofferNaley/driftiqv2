/**
 * Vedlikehold — port av v1s `routers/maintenance.py`.
 *
 * To halvdeler: bygningselementer med FDV-dokumentasjon og servicehistorikk, og arbeid
 * utført i enkeltenheter. De henger sammen gjennom `unitWorks.elementId`, som lar planen
 * vise «34 av 60 enheter utført» i stedet for ett årstall som skjuler at arbeidet pågår.
 */

import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { units } from "../db/schema/units";
import {
  buildingElements,
  elementDocuments,
  elementServices,
  unitWorkDocuments,
  unitWorks,
} from "../db/schema/vedlikehold";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet, ugyldig } from "./api";
import { lagreFil, slettFil } from "./lagring";
import type { Aktor } from "./aktor";

/**
 * FDV-slottene. Rekkefølgen styrer visningen, og lista driver komplett-prosenten:
 * «annet» teller IKKE med, siden en samlepose ikke sier noe om hva som mangler.
 */
export const FDV_TYPER = [
  "bruksanvisning",
  "samsvar",
  "tegninger",
  "vedlikeholdsinstruks",
  "garanti",
  "annet",
] as const;

/** Slottene som teller mot komplett-prosenten. */
export const FDV_KRAV = FDV_TYPER.filter((t) => t !== "annet");

export const ARBEIDSDOK_TYPER = ["bilde", "faktura", "samsvar", "rapport", "annet"] as const;
export const TILSTANDSGRADER = ["TG0", "TG1", "TG2", "TG3"] as const;
export const ARBEIDSTYPER = ["vedlikehold", "påkostning"] as const;
export const BETALER = ["borettslag", "andelseier", "forsikring", "annet"] as const;

const tekst = z.string().trim().nullish();
const aar = z.number().int().min(1800).max(2200).nullish();

export const elementInn = z.object({
  name: z.string().trim().min(1, "Navn er påkrevd"),
  icon: z.string().trim().default("🏗"),
  category: tekst,
  installedYear: aar,
  conditionGrade: z.enum(TILSTANDSGRADER).nullish(),
  expectedLifetimeYears: z.number().int().min(0).nullish(),
  nextActionYear: aar,
  estimatedCost: z.number().int().min(0).nullish(),
  vendorId: z.string().nullish(),
  warrantyYears: z.number().int().min(0).nullish(),
  warrantyExpires: z.string().date().nullish(),
  notes: z.string().nullish(),
});

export const elementEndring = elementInn.partial();

export const serviceInn = z.object({
  serviceDate: z.string().date(),
  title: z.string().trim().min(1, "Tittel er påkrevd"),
  performedBy: tekst,
  notes: z.string().nullish(),
});

export const arbeidInn = z.object({
  unitId: z.string().min(1, "Enhet må velges"),
  elementId: z.string().nullish(),
  category: z.string().trim().default("annet"),
  workType: z.enum(ARBEIDSTYPER).default("vedlikehold"),
  workDate: z.string().date(),
  title: z.string().trim().min(1, "Tittel er påkrevd"),
  description: z.string().nullish(),
  vendorId: z.string().nullish(),
  performedBy: tekst,
  paidBy: z.enum(BETALER).default("borettslag"),
  cost: z.number().int().min(0).nullish(),
});

export const arbeidEndring = arbeidInn.partial().omit({ unitId: true });

const iDag = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------
// Bygningselementer
// ---------------------------------------------------------------------------------------

async function krevIEgenOrg(
  db: Db,
  orgId: string,
  f: { vendorId?: string | null; unitId?: string | null; elementId?: string | null },
) {
  if (f.vendorId) {
    const r = await db.select({ id: vendors.id }).from(vendors)
      .where(and(eq(vendors.id, f.vendorId), eq(vendors.orgId, orgId))).limit(1);
    if (r.length === 0) throw ugyldig("Ugyldig leverandør for denne organisasjonen");
  }
  if (f.unitId) {
    const r = await db.select({ id: units.id }).from(units)
      .where(and(eq(units.id, f.unitId), eq(units.orgId, orgId))).limit(1);
    if (r.length === 0) throw ugyldig("Ugyldig enhet for denne organisasjonen");
  }
  if (f.elementId) {
    const r = await db.select({ id: buildingElements.id }).from(buildingElements)
      .where(and(eq(buildingElements.id, f.elementId), eq(buildingElements.orgId, orgId))).limit(1);
    if (r.length === 0) throw ugyldig("Ugyldig bygningsdel for denne organisasjonen");
  }
}

/**
 * Garantistatus utledet av `warrantyExpires` — aldri lagret.
 * En lagret status ville vært riktig én dag og feil for alltid etterpå.
 */
export function garantistatus(warrantyExpires: string | null): "aktiv" | "utløpt" | "ukjent" {
  if (!warrantyExpires) return "ukjent";
  return warrantyExpires >= iDag() ? "aktiv" : "utløpt";
}

/**
 * Andel av FDV-slottene som er fylt. «annet» teller ikke — en samlepose sier ingenting om
 * hva som faktisk mangler, og ville gjort det mulig å nå 100 % med seks tilfeldige filer.
 */
export function fdvKomplett(typer: string[]): { fylt: number; av: number; prosent: number } {
  const unike = new Set(typer.filter((t) => FDV_KRAV.includes(t as (typeof FDV_KRAV)[number])));
  return {
    fylt: unike.size,
    av: FDV_KRAV.length,
    prosent: Math.round((unike.size / FDV_KRAV.length) * 100),
  };
}

export async function hentElementer(db: Db, orgId: string) {
  const rader = await db
    .select({ element: buildingElements, vendorName: vendors.name })
    .from(buildingElements)
    .leftJoin(vendors, eq(vendors.id, buildingElements.vendorId))
    .where(eq(buildingElements.orgId, orgId))
    .orderBy(asc(buildingElements.name));

  // Én spørring for FDV-typene, ikke én per element.
  const typer = await db
    .select({ elementId: elementDocuments.elementId, fdvType: elementDocuments.fdvType })
    .from(elementDocuments)
    .where(eq(elementDocuments.orgId, orgId));

  const perElement = new Map<string, string[]>();
  for (const t of typer) {
    perElement.set(t.elementId, [...(perElement.get(t.elementId) ?? []), t.fdvType]);
  }

  return rader.map((r) => ({
    ...r.element,
    vendorName: r.vendorName,
    garanti: garantistatus(r.element.warrantyExpires),
    fdv: fdvKomplett(perElement.get(r.element.id) ?? []),
  }));
}

export async function hentElement(db: Db, orgId: string, elementId: string) {
  const rader = await db
    .select()
    .from(buildingElements)
    .where(and(eq(buildingElements.id, elementId), eq(buildingElements.orgId, orgId)))
    .limit(1);
  const element = rader[0];
  if (!element) throw ikkeFunnet("Bygningselement");

  const [dokumenter, historikk, arbeider] = await Promise.all([
    db.select().from(elementDocuments).where(eq(elementDocuments.elementId, elementId))
      .orderBy(asc(elementDocuments.fdvType)),
    db.select().from(elementServices).where(eq(elementServices.elementId, elementId))
      .orderBy(desc(elementServices.serviceDate)),
    // «34 av 60 enheter utført» — se kommentaren på `unitWorks.elementId`.
    db.select({ antall: count() }).from(unitWorks).where(eq(unitWorks.elementId, elementId)),
  ]);

  return {
    ...element,
    garanti: garantistatus(element.warrantyExpires),
    fdv: fdvKomplett(dokumenter.map((d) => d.fdvType)),
    dokumenter,
    historikk,
    antallEnhetsarbeider: arbeider[0]?.antall ?? 0,
  };
}

export async function opprettElement(db: Db, orgId: string, data: z.infer<typeof elementInn>) {
  await krevIEgenOrg(db, orgId, data);
  const [ny] = await db.insert(buildingElements)
    .values({ id: randomUUID(), orgId, ...data }).returning();
  return ny!;
}

export async function endreElement(
  db: Db,
  orgId: string,
  elementId: string,
  data: z.infer<typeof elementEndring>,
) {
  await hentElement(db, orgId, elementId);
  await krevIEgenOrg(db, orgId, data);
  const [endret] = await db.update(buildingElements).set(data)
    .where(and(eq(buildingElements.id, elementId), eq(buildingElements.orgId, orgId))).returning();
  return endret!;
}

/**
 * Sletter elementet. FDV-dokumenter og servicehistorikk følger med (de har ingen mening
 * uten elementet), men enhetsarbeider blir stående med `elementId = NULL` — arbeidet i
 * leiligheten ble faktisk gjort, uavhengig av hvordan planen senere ble organisert.
 */
export async function slettElement(db: Db, orgId: string, elementId: string) {
  const element = await hentElement(db, orgId, elementId);

  for (const d of element.dokumenter) {
    await slettFil(orgId, "element_documents", d.filename);
  }
  await db.delete(buildingElements)
    .where(and(eq(buildingElements.id, elementId), eq(buildingElements.orgId, orgId)));
}

// ---------------------------------------------------------------------------------------
// FDV-dokumenter og servicehistorikk
// ---------------------------------------------------------------------------------------

export async function lastOppFdv(
  db: Db,
  orgId: string,
  elementId: string,
  lastetOppAv: string,
  fil: File,
  meta: { fdvType: string; title?: string },
) {
  await hentElement(db, orgId, elementId);
  if (!(FDV_TYPER as readonly string[]).includes(meta.fdvType)) throw ugyldig("Ugyldig FDV-type");

  const opplasting = await lagreFil(db, orgId, "element_documents", fil);
  const [ny] = await db.insert(elementDocuments).values({
    id: randomUUID(),
    elementId,
    orgId,
    fdvType: meta.fdvType,
    title: meta.title?.trim() || opplasting.originalnavn,
    filename: opplasting.filnavn,
    originalName: opplasting.originalnavn,
    contentType: opplasting.contentType,
    fileSize: opplasting.storrelse,
    uploadedBy: lastetOppAv,
  }).returning();
  return ny!;
}

export async function slettFdv(db: Db, orgId: string, elementId: string, docId: string) {
  const rader = await db.select().from(elementDocuments)
    .where(and(eq(elementDocuments.id, docId), eq(elementDocuments.elementId, elementId),
               eq(elementDocuments.orgId, orgId))).limit(1);
  const dok = rader[0];
  if (!dok) throw ikkeFunnet("Dokument");

  await db.delete(elementDocuments).where(eq(elementDocuments.id, docId));
  await slettFil(orgId, "element_documents", dok.filename);
}

export async function leggTilService(
  db: Db,
  orgId: string,
  elementId: string,
  data: z.infer<typeof serviceInn>,
) {
  await hentElement(db, orgId, elementId);
  const [ny] = await db.insert(elementServices)
    .values({ id: randomUUID(), elementId, orgId, ...data }).returning();
  return ny!;
}

export async function endreService(
  db: Db,
  orgId: string,
  elementId: string,
  serviceId: string,
  data: Partial<z.infer<typeof serviceInn>>,
) {
  const [endret] = await db.update(elementServices).set(data)
    .where(and(eq(elementServices.id, serviceId), eq(elementServices.elementId, elementId),
               eq(elementServices.orgId, orgId))).returning();
  if (!endret) throw ikkeFunnet("Serviceoppføring");
  return endret;
}

export async function slettService(db: Db, orgId: string, elementId: string, serviceId: string) {
  const slettet = await db.delete(elementServices)
    .where(and(eq(elementServices.id, serviceId), eq(elementServices.elementId, elementId),
               eq(elementServices.orgId, orgId))).returning({ id: elementServices.id });
  if (slettet.length === 0) throw ikkeFunnet("Serviceoppføring");
}

// ---------------------------------------------------------------------------------------
// Arbeid i enkeltenheter
// ---------------------------------------------------------------------------------------

/** Enhetens identitet slik den ser ut NÅ — kopieres inn på arbeidet ved registrering. */
function enhetsmerke(u: { andelsnr: string | null; leilighetsnr: string | null; oppgang: string | null; navn: string | null }): string {
  const deler = [u.leilighetsnr ?? u.navn, u.oppgang ? `oppg. ${u.oppgang}` : null].filter(Boolean);
  if (deler.length > 0) return deler.join(" · ");
  return u.andelsnr ? `Andel ${u.andelsnr}` : "Ukjent enhet";
}

export async function hentArbeider(db: Db, orgId: string, filter: { unitId?: string; elementId?: string } = {}) {
  const betingelser = [eq(unitWorks.orgId, orgId)];
  if (filter.unitId) betingelser.push(eq(unitWorks.unitId, filter.unitId));
  if (filter.elementId) betingelser.push(eq(unitWorks.elementId, filter.elementId));

  const rader = await db
    .select({ arbeid: unitWorks, vendorName: vendors.name })
    .from(unitWorks)
    .leftJoin(vendors, eq(vendors.id, unitWorks.vendorId))
    .where(and(...betingelser))
    .orderBy(desc(unitWorks.workDate));

  return rader.map((r) => ({ ...r.arbeid, vendorName: r.vendorName }));
}

export async function hentArbeid(db: Db, orgId: string, workId: string) {
  const rader = await db.select().from(unitWorks)
    .where(and(eq(unitWorks.id, workId), eq(unitWorks.orgId, orgId))).limit(1);
  const arbeid = rader[0];
  if (!arbeid) throw ikkeFunnet("Arbeidsoppføringen");

  const dokumenter = await db.select().from(unitWorkDocuments)
    .where(eq(unitWorkDocuments.workId, workId)).orderBy(asc(unitWorkDocuments.uploadedAt));
  return { ...arbeid, dokumenter };
}

export async function registrerArbeid(
  db: Db,
  orgId: string,
  registrertAv: Aktor,
  data: z.infer<typeof arbeidInn>,
) {
  await krevIEgenOrg(db, orgId, data);

  const enhet = await db.select().from(units)
    .where(and(eq(units.id, data.unitId), eq(units.orgId, orgId))).limit(1);
  if (!enhet[0]) throw ugyldig("Ugyldig enhet for denne organisasjonen");

  const [ny] = await db.insert(unitWorks).values({
    id: randomUUID(),
    orgId,
    ...data,
    unitLabel: enhetsmerke(enhet[0]),
    createdBy: registrertAv.navn,
    createdByUserId: registrertAv.brukerId,
  }).returning();
  return ny!;
}

export async function endreArbeid(
  db: Db,
  orgId: string,
  workId: string,
  data: z.infer<typeof arbeidEndring>,
) {
  await hentArbeid(db, orgId, workId);
  await krevIEgenOrg(db, orgId, data);
  const [endret] = await db.update(unitWorks).set(data)
    .where(and(eq(unitWorks.id, workId), eq(unitWorks.orgId, orgId))).returning();
  return endret!;
}

export async function slettArbeid(db: Db, orgId: string, workId: string) {
  const arbeid = await hentArbeid(db, orgId, workId);
  for (const d of arbeid.dokumenter) {
    await slettFil(orgId, "unit_work_documents", d.filename);
  }
  await db.delete(unitWorks).where(and(eq(unitWorks.id, workId), eq(unitWorks.orgId, orgId)));
}

export async function lastOppArbeidsdok(
  db: Db,
  orgId: string,
  workId: string,
  lastetOppAv: string,
  fil: File,
  meta: { docType: string; title?: string },
) {
  await hentArbeid(db, orgId, workId);
  if (!(ARBEIDSDOK_TYPER as readonly string[]).includes(meta.docType)) {
    throw ugyldig("Ugyldig dokumenttype");
  }

  const opplasting = await lagreFil(db, orgId, "unit_work_documents", fil);
  const [ny] = await db.insert(unitWorkDocuments).values({
    id: randomUUID(),
    workId,
    orgId,
    docType: meta.docType,
    title: meta.title?.trim() || opplasting.originalnavn,
    filename: opplasting.filnavn,
    originalName: opplasting.originalnavn,
    contentType: opplasting.contentType,
    fileSize: opplasting.storrelse,
    uploadedBy: lastetOppAv,
  }).returning();
  return ny!;
}

export async function slettArbeidsdok(db: Db, orgId: string, workId: string, docId: string) {
  const rader = await db.select().from(unitWorkDocuments)
    .where(and(eq(unitWorkDocuments.id, docId), eq(unitWorkDocuments.workId, workId),
               eq(unitWorkDocuments.orgId, orgId))).limit(1);
  const dok = rader[0];
  if (!dok) throw ikkeFunnet("Dokument");

  await db.delete(unitWorkDocuments).where(eq(unitWorkDocuments.id, docId));
  await slettFil(orgId, "unit_work_documents", dok.filename);
}

/**
 * Kostnadsoppsummering per arbeidstype. Skillet vedlikehold/påkostning avgjør
 * regnskapsføringen, så tallene må kunne leses ut hver for seg.
 */
export async function kostnaderPerType(db: Db, orgId: string, aar?: number) {
  const betingelser = [eq(unitWorks.orgId, orgId)];
  if (aar) betingelser.push(sql`EXTRACT(YEAR FROM ${unitWorks.workDate}) = ${aar}`);

  const rader = await db
    .select({
      workType: unitWorks.workType,
      paidBy: unitWorks.paidBy,
      sum: sql<number>`COALESCE(SUM(${unitWorks.cost}), 0)::int`,
      antall: count(),
    })
    .from(unitWorks)
    .where(and(...betingelser))
    .groupBy(unitWorks.workType, unitWorks.paidBy);
  return rader;
}
