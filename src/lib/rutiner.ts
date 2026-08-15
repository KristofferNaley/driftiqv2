/**
 * Rutiner — port av v1s `routers/routines.py`.
 *
 * To ting skiller denne modulen fra de andre: statusen regnes ut i stedet for å lagres, og
 * versjonshistorikken tas FØR endringen skrives.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { routineSteps, routineVersions, routines, type Routine } from "../db/schema/rutiner";
import { vendorContacts } from "../db/schema/vendors";
import { ikkeFunnet } from "./api";

export const STATUSER = ["utkast", "publisert"] as const;
export const CALLOUT_TYPER = ["warning", "contact"] as const;

/** Statusen brukeren faktisk ser. Regnes ut, aldri lagret. */
export type EffektivStatus = "utkast" | "aktiv" | "trenger_gjennomgang";

const tekst = z.string().trim().nullish();

export const stegInn = z.object({
  title: z.string().trim().min(1, "Steget må ha en tittel"),
  description: z.string().nullish(),
  isCritical: z.boolean().default(false),
  calloutType: z.enum(CALLOUT_TYPER).nullish(),
  calloutText: z.string().nullish(),
});

export const rutineInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  category: tekst,
  responsible: tekst,
  appliesTo: tekst,
  isCritical: z.boolean().default(false),
  reviewIntervalMonths: z.number().int().min(1).nullish(),
  status: z.enum(STATUSER).default("utkast"),
  vendorId: z.string().nullish(),
  contractId: z.string().nullish(),
  documentId: z.string().nullish(),
  taskId: z.string().nullish(),
  internkontrollNote: tekst,
  steps: z.array(stegInn).optional(),
});

export const rutineEndring = rutineInn.partial();

const iDag = () => new Date().toISOString().slice(0, 10);

/**
 * Statusen slik den fremstår for brukeren.
 *
 * Et utkast er alltid utkast. En publisert rutine er «aktiv» til revisjonsintervallet er
 * passert, og da «trenger gjennomgang». NULL-intervall betyr at kunden har slått av
 * påminnelsen — da skal rutinen aldri flagges av seg selv.
 *
 * Dette er utledet og ikke lagret med vilje: en manuelt satt «aktiv» ville gjort
 * 12-måneders-varselet meningsløst, siden man kunne skru det av ved å sette statusen.
 */
export function effektivStatus(r: Pick<Routine, "status" | "reviewIntervalMonths" | "lastReviewedAt">): EffektivStatus {
  if (r.status === "utkast") return "utkast";
  if (r.reviewIntervalMonths === null || r.reviewIntervalMonths === undefined) return "aktiv";
  if (!r.lastReviewedAt) return "trenger_gjennomgang";

  const frist = new Date(`${r.lastReviewedAt}T00:00:00Z`);
  frist.setUTCDate(frist.getUTCDate() + r.reviewIntervalMonths * 30);
  return frist.toISOString().slice(0, 10) < iDag() ? "trenger_gjennomgang" : "aktiv";
}

/**
 * Rutinens leverandørs primærkontakt, slått opp LIVE.
 *
 * Steg med `calloutType: "contact"` viser denne. Den kopieres bevisst ikke inn i steget:
 * bytter vaktmesterfirmaet telefonnummer, skal rutinen vise det nye uten at noen må
 * redigere teksten.
 */
async function primaerkontakt(db: Db, vendorId: string | null) {
  if (!vendorId) return null;
  const rader = await db
    .select()
    .from(vendorContacts)
    .where(and(eq(vendorContacts.vendorId, vendorId), eq(vendorContacts.isPrimary, true)))
    .limit(1);
  return rader[0] ?? null;
}

export async function hentRutiner(db: Db, orgId: string) {
  const rader = await db
    .select()
    .from(routines)
    .where(eq(routines.orgId, orgId))
    .orderBy(desc(routines.isCritical), asc(routines.title));
  return rader.map((r) => ({ ...r, effektivStatus: effektivStatus(r) }));
}

export async function hentRutine(db: Db, orgId: string, routineId: string) {
  const rader = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, routineId), eq(routines.orgId, orgId)))
    .limit(1);
  const rutine = rader[0];
  if (!rutine) throw ikkeFunnet("Rutine");

  const [steg, kontakt, versjoner] = await Promise.all([
    db.select().from(routineSteps).where(eq(routineSteps.routineId, routineId)).orderBy(asc(routineSteps.order)),
    primaerkontakt(db, rutine.vendorId),
    db.select().from(routineVersions).where(eq(routineVersions.routineId, routineId))
      .orderBy(desc(routineVersions.versionNumber)),
  ]);

  return {
    ...rutine,
    effektivStatus: effektivStatus(rutine),
    steg: steg.map((s) => ({ ...s, kontakt: s.calloutType === "contact" ? kontakt : null })),
    versjoner,
  };
}

async function skrivSteg(db: Db, routineId: string, steg: z.infer<typeof stegInn>[]) {
  await db.delete(routineSteps).where(eq(routineSteps.routineId, routineId));
  if (steg.length === 0) return;
  await db.insert(routineSteps).values(
    steg.map((s, n) => ({
      id: randomUUID(),
      routineId,
      order: n,
      ...s,
      // «contact» har ingen lagret tekst — den løses live. Lagres den likevel, blir den
      // liggende og bli feil neste gang leverandøren bytter kontaktperson.
      calloutText: s.calloutType === "contact" ? null : s.calloutText,
    })),
  );
}

export async function opprettRutine(db: Db, orgId: string, data: z.infer<typeof rutineInn>) {
  const { steps, ...felter } = data;
  const [ny] = await db
    .insert(routines)
    .values({ id: randomUUID(), orgId, qrToken: randomUUID(), ...felter })
    .returning();
  if (steps) await skrivSteg(db, ny!.id, steps);
  return hentRutine(db, orgId, ny!.id);
}

/**
 * Tar vare på rutinens tilstand FØR endringen som er på vei inn, og teller opp versjonen.
 *
 * Historikk skal ikke kunne endres i ettertid. Ved tilsyn må styret kunne vise hvilken
 * rutine som gjaldt på et gitt tidspunkt, og det går bare hvis snapshotet tas før og ikke
 * etter.
 */
async function snapshotOgBump(db: Db, rutine: Routine, endretAv: string) {
  const steg = await db
    .select()
    .from(routineSteps)
    .where(eq(routineSteps.routineId, rutine.id))
    .orderBy(asc(routineSteps.order));

  await db.insert(routineVersions).values({
    id: randomUUID(),
    routineId: rutine.id,
    orgId: rutine.orgId,
    versionNumber: rutine.version,
    contentSnapshot: JSON.stringify({
      title: rutine.title,
      description: rutine.description,
      category: rutine.category,
      responsible: rutine.responsible,
      appliesTo: rutine.appliesTo,
      isCritical: rutine.isCritical,
      reviewIntervalMonths: rutine.reviewIntervalMonths,
      internkontrollNote: rutine.internkontrollNote,
      status: rutine.status,
      steps: steg,
    }),
    changedBy: endretAv,
  });
}

export async function endreRutine(
  db: Db,
  orgId: string,
  routineId: string,
  endretAv: string,
  data: z.infer<typeof rutineEndring>,
) {
  const rader = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, routineId), eq(routines.orgId, orgId)))
    .limit(1);
  const rutine = rader[0];
  if (!rutine) throw ikkeFunnet("Rutine");

  await snapshotOgBump(db, rutine, endretAv);

  const { steps, ...felter } = data;
  await db
    .update(routines)
    .set({ ...felter, version: rutine.version + 1 })
    .where(and(eq(routines.id, routineId), eq(routines.orgId, orgId)));
  if (steps) await skrivSteg(db, routineId, steps);

  return hentRutine(db, orgId, routineId);
}

/** Markerer rutinen som gjennomgått i dag. Nullstiller «trenger gjennomgang». */
export async function markerGjennomgatt(db: Db, orgId: string, routineId: string) {
  await hentRutine(db, orgId, routineId);
  const [endret] = await db
    .update(routines)
    .set({ lastReviewedAt: iDag() })
    .where(and(eq(routines.id, routineId), eq(routines.orgId, orgId)))
    .returning();
  return { ...endret!, effektivStatus: effektivStatus(endret!) };
}

export async function slettRutine(db: Db, orgId: string, routineId: string) {
  await hentRutine(db, orgId, routineId);
  await db.delete(routines).where(and(eq(routines.id, routineId), eq(routines.orgId, orgId)));
}

/** Offentlig visning via QR-token. Ingen org-kontekst — tokenet er nøkkelen. */
export async function hentViaQr(db: Db, token: string) {
  const rader = await db.select().from(routines).where(eq(routines.qrToken, token)).limit(1);
  const rutine = rader[0];
  if (!rutine || rutine.status !== "publisert") throw ikkeFunnet("Rutine");

  const [steg, kontakt] = await Promise.all([
    db.select().from(routineSteps).where(eq(routineSteps.routineId, rutine.id)).orderBy(asc(routineSteps.order)),
    primaerkontakt(db, rutine.vendorId),
  ]);
  return {
    title: rutine.title,
    description: rutine.description,
    responsible: rutine.responsible,
    isCritical: rutine.isCritical,
    steg: steg.map((s) => ({ ...s, kontakt: s.calloutType === "contact" ? kontakt : null })),
  };
}
