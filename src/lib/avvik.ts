/**
 * Avvik — port av v1s `routers/deviations.py`.
 *
 * ## Tre statuser, én vei ut
 *
 * `ny` → `under_behandling` → `lukket`. Lukking skjer KUN via `lukkAvvik()`, aldri ved å
 * sette status direkte: lukkingen krever en løsningsbeskrivelse, og det kravet ville vært
 * trivielt å omgå hvis status var et vanlig felt. Et lukket avvik kan heller ikke endres.
 *
 * ## Ikke portert ennå
 *
 * - Vedlegg (`deviation_attachments`) — venter på fillagring.
 * - `roundId`/`roundItemId` — peker på Internkontroll, som ikke er portert.
 */

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { deviationLogs, deviationTreatments, deviations } from "../db/schema/avvik";
import { units } from "../db/schema/units";
import { userOrgMemberships, users } from "../db/schema/users";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet, ugyldig } from "./api";

export const STATUSER = ["ny", "under_behandling", "lukket"] as const;
export const ALVORLIGHET = ["lav", "middels", "akutt"] as const;

/** Statusene en bruker kan sette direkte. `lukket` er bevisst utenfor. */
export const APNE_STATUSER = ["ny", "under_behandling"] as const;

export const avvikInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  category: z.string().trim().nullish(),
  severity: z.enum(ALVORLIGHET).nullish(),
  taskId: z.string().nullish(),
  vendorId: z.string().nullish(),
  unitId: z.string().nullish(),
  responsibleUserId: z.string().nullish(),
  dueDate: z.string().date().nullish(),
});

export const avvikEndring = avvikInn.partial().extend({
  status: z.enum(APNE_STATUSER).optional(),
});

export const lukkInn = z.object({
  resolvedBy: z.string().trim().min(1, "Navn må fylles ut"),
  resolutionNotes: z.string().trim().min(1, "Avviket kan ikke lukkes uten en løsningsbeskrivelse."),
});

export const behandlingInn = z.object({
  text: z.string().trim().min(1, "Innlegget kan ikke være tomt"),
});

async function skrivLogg(db: Db, deviationId: string, av: string, hendelse: string) {
  await db.insert(deviationLogs).values({
    id: randomUUID(),
    deviationId,
    changedBy: av,
    event: hendelse,
  });
}

/** Fremmednøkler må peke inn i SAMME org. Ansvarlig må i tillegg være MEDLEM av org-en. */
async function validerKoblinger(
  db: Db,
  orgId: string,
  f: { vendorId?: string | null; unitId?: string | null; responsibleUserId?: string | null },
) {
  if (f.vendorId) {
    const r = await db.select({ id: vendors.id }).from(vendors)
      .where(and(eq(vendors.id, f.vendorId), eq(vendors.orgId, orgId))).limit(1);
    if (r.length === 0) throw ikkeFunnet("Leverandør");
  }
  if (f.unitId) {
    const r = await db.select({ id: units.id }).from(units)
      .where(and(eq(units.id, f.unitId), eq(units.orgId, orgId))).limit(1);
    if (r.length === 0) throw ikkeFunnet("Enhet");
  }
  if (f.responsibleUserId) {
    // Ikke bare «finnes brukeren», men «er de medlem her». Uten dette kunne et avvik
    // tildeles noen i et annet borettslag, og de ville sett det i «mine avvik».
    const r = await db.select({ id: userOrgMemberships.id }).from(userOrgMemberships)
      .where(and(
        eq(userOrgMemberships.userId, f.responsibleUserId),
        eq(userOrgMemberships.orgId, orgId),
      )).limit(1);
    if (r.length === 0) throw ugyldig("Ansvarlig må være medlem av organisasjonen.");
  }
}

/** Ansvarliges NÅVÆRENDE navn vinner over det lagrede — et navnebytte skal ikke vises feil. */
function medAnsvarlig<T extends { assignedTo: string | null }>(rad: T, brukernavn: string | null) {
  return { ...rad, assignedTo: brukernavn ?? rad.assignedTo };
}

export async function hentAvvik(db: Db, orgId: string, opts: { lukkede?: boolean } = {}) {
  const betingelser = [eq(deviations.orgId, orgId)];
  if (opts.lukkede === true) betingelser.push(eq(deviations.status, "lukket"));
  if (opts.lukkede === false) betingelser.push(sql`${deviations.status} <> 'lukket'`);

  const rader = await db
    .select({ avvik: deviations, brukernavn: users.name, unitNavn: units.navn })
    .from(deviations)
    .leftJoin(users, eq(users.id, deviations.responsibleUserId))
    .leftJoin(units, eq(units.id, deviations.unitId))
    .where(and(...betingelser))
    .orderBy(desc(deviations.number));

  return rader.map((r) => ({ ...medAnsvarlig(r.avvik, r.brukernavn), unitNavn: r.unitNavn }));
}

export async function hentEttAvvik(db: Db, orgId: string, devId: string) {
  const rader = await db
    .select({ avvik: deviations, brukernavn: users.name })
    .from(deviations)
    .leftJoin(users, eq(users.id, deviations.responsibleUserId))
    .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)))
    .limit(1);
  const rad = rader[0];
  if (!rad) throw ikkeFunnet("Avvik");

  const [behandlinger, logg] = await Promise.all([
    db.select().from(deviationTreatments)
      .where(eq(deviationTreatments.deviationId, devId))
      .orderBy(asc(deviationTreatments.createdAt)),
    db.select().from(deviationLogs)
      .where(eq(deviationLogs.deviationId, devId))
      .orderBy(asc(deviationLogs.changedAt)),
  ]);

  return { ...medAnsvarlig(rad.avvik, rad.brukernavn), behandlinger, logg };
}

/** Neste løpenummer i org-en. Tildeles ved opprettelse og endres aldri. */
async function nesteNummer(db: Db, orgId: string): Promise<number> {
  const rader = await db
    .select({ maks: sql<number | null>`max(${deviations.number})` })
    .from(deviations)
    .where(eq(deviations.orgId, orgId));
  return (rader[0]?.maks ?? 0) + 1;
}

export async function opprettAvvik(
  db: Db,
  orgId: string,
  melder: string,
  data: z.infer<typeof avvikInn>,
) {
  await validerKoblinger(db, orgId, data);

  const navn = data.responsibleUserId
    ? (await db.select({ name: users.name }).from(users).where(eq(users.id, data.responsibleUserId)).limit(1))[0]?.name
    : null;

  const [ny] = await db
    .insert(deviations)
    .values({
      id: randomUUID(),
      orgId,
      number: await nesteNummer(db, orgId),
      reportedBy: melder,
      assignedTo: navn ?? null,
      ...data,
    })
    .returning();

  await skrivLogg(db, ny!.id, melder, `Avvik meldt av ${melder}`);
  return ny!;
}

export async function endreAvvik(
  db: Db,
  orgId: string,
  devId: string,
  endretAv: string,
  data: z.infer<typeof avvikEndring>,
) {
  const avvik = await hentEttAvvik(db, orgId, devId);
  // Et lukket avvik er dokumentasjon. Skal det åpnes igjen, er det en egen handling.
  if (avvik.status === "lukket") {
    throw ugyldig("Avviket er lukket og kan ikke endres.");
  }
  await validerKoblinger(db, orgId, data);

  const patch: Record<string, unknown> = { ...data };
  if (data.responsibleUserId !== undefined) {
    // Feltene holdes i takt ved skriving — se kommentaren på `deviations.assignedTo`.
    patch.assignedTo = data.responsibleUserId
      ? (await db.select({ name: users.name }).from(users).where(eq(users.id, data.responsibleUserId)).limit(1))[0]?.name ?? null
      : null;
  }

  const [endret] = await db
    .update(deviations)
    .set(patch)
    .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)))
    .returning();

  if (data.status && data.status !== avvik.status) {
    await skrivLogg(db, devId, endretAv, `Status endret til ${data.status} av ${endretAv}`);
  }
  return endret!;
}

/**
 * Lukker avviket. Eneste vei til status `lukket`.
 *
 * Løsningsbeskrivelsen er påkrevd av Zod-skjemaet: den er siste ledd i dokumentasjonskjeden
 * som havner i internkontrollpermen, og et avvik lukket med tom begrunnelse dokumenterer
 * ingenting.
 */
export async function lukkAvvik(
  db: Db,
  orgId: string,
  devId: string,
  data: z.infer<typeof lukkInn>,
) {
  const avvik = await hentEttAvvik(db, orgId, devId);
  if (avvik.status === "lukket") throw ugyldig("Avviket er allerede lukket.");

  const [lukket] = await db
    .update(deviations)
    .set({
      status: "lukket",
      resolvedAt: sql`now()`,
      resolvedBy: data.resolvedBy,
      resolutionNotes: data.resolutionNotes,
    })
    .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)))
    .returning();

  await skrivLogg(
    db,
    devId,
    data.resolvedBy,
    `Avvik lukket av ${data.resolvedBy}. Løsning: ${data.resolutionNotes}`,
  );
  return lukket!;
}

/** Legger et innlegg i behandlingsjournalen. Append-only — se kommentaren på tabellen. */
export async function leggTilBehandling(
  db: Db,
  orgId: string,
  devId: string,
  forfatter: string,
  data: z.infer<typeof behandlingInn>,
) {
  const avvik = await hentEttAvvik(db, orgId, devId);
  if (avvik.status === "lukket") {
    throw ugyldig("Avviket er lukket — behandlingen kan ikke fortsette.");
  }

  const [ny] = await db
    .insert(deviationTreatments)
    .values({ id: randomUUID(), deviationId: devId, text: data.text, createdBy: forfatter })
    .returning();

  // Første behandlingsinnlegg flytter avviket fra «ny» til «under behandling» av seg selv.
  // Å kreve at brukeren gjør begge deler manuelt gir bare statuser som ligger og henger.
  if (avvik.status === "ny") {
    await db.update(deviations).set({ status: "under_behandling" })
      .where(and(eq(deviations.id, devId), eq(deviations.orgId, orgId)));
    await skrivLogg(db, devId, forfatter, `Behandling startet av ${forfatter}`);
  }
  return ny!;
}

/** Antall per status — grunnlaget for KPI-ene på dashbordet. */
export async function tellPerStatus(db: Db, orgId: string) {
  const rader = await db
    .select({ status: deviations.status, antall: sql<number>`count(*)::int` })
    .from(deviations)
    .where(eq(deviations.orgId, orgId))
    .groupBy(deviations.status);
  return Object.fromEntries(rader.map((r) => [r.status, r.antall]));
}

/** Antall åpne avvik per enhet. Feltet Enhetsregisteret har ventet på. */
export async function apneAvvikPerEnhet(db: Db, orgId: string): Promise<Map<string, number>> {
  const rader = await db
    .select({ unitId: deviations.unitId, antall: sql<number>`count(*)::int` })
    .from(deviations)
    .where(and(
      eq(deviations.orgId, orgId),
      isNotNull(deviations.unitId),
      sql`${deviations.status} <> 'lukket'`,
    ))
    .groupBy(deviations.unitId);
  return new Map(rader.map((r) => [r.unitId!, r.antall]));
}
