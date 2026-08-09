/**
 * Oppgaver — port av v1s `routers/tasks.py`.
 *
 * Forsinket-regelen bor IKKE her, men i `oppgaveregler.ts`, som både server og klient
 * importerer. Se den fila for hvorfor.
 *
 * ## Ikke portert ennå
 *
 * - QR-bildegenerering (`GET /{id}/qr`) og selve QR-innsendingsskjemaet — de er anonyme og
 *   hører til en egen rute utenfor `/organizations/`.
 * - Bilder på utkvitteringer (`completion_photos`) — venter på fillagring.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import {
  completionChecklistResults,
  completions,
  taskChecklistItems,
  tasks,
} from "../db/schema/tasks";
import { deviations } from "../db/schema/avvik";
import { units } from "../db/schema/units";
import { users } from "../db/schema/users";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet, ugyldig } from "./api";
import { erForsinket, nesteFrist } from "./oppgaveregler";

export const FREKVENSER = [
  "weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual",
  "every_3_years", "every_5_years", "every_8_years", "on_demand",
] as const;

export const oppgaveInn = z.object({
  vendorId: z.string().min(1, "Leverandør må velges"),
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  location: z.string().trim().nullish(),
  unitId: z.string().nullish(),
  responsibleUserId: z.string().nullish(),
  frequency: z.enum(FREKVENSER),
  startDate: z.string().date().nullish(),
  dueDate: z.string().date().nullish(),
  showOnArshjul: z.boolean().default(false),
});

export const oppgaveEndring = oppgaveInn.partial().extend({ active: z.boolean().optional() });

export const utkvitteringInn = z.object({
  completedAt: z.string().date().optional(),
  notes: z.string().nullish(),
  hasDeviation: z.boolean().default(false),
  deviationDescription: z.string().nullish(),
  severity: z.enum(["lav", "middels", "akutt"]).nullish(),
  /** Sjekkpunktene som ble huket av. Resten føres som ikke utført, ikke som utelatt. */
  checkedItemIds: z.array(z.string()).default([]),
});

export const sjekklisteInn = z.object({
  items: z.array(z.object({ text: z.string().trim().min(1, "Sjekkpunkt kan ikke være tomt") })),
});

const iDag = () => new Date().toISOString().slice(0, 10);

/** Fremmednøkler må peke inn i SAMME org, ellers lekker data på tvers av kunder. */
async function krevIEgenOrg(db: Db, orgId: string, felt: { vendorId?: string | null; unitId?: string | null }) {
  if (felt.vendorId) {
    const rader = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, felt.vendorId), eq(vendors.orgId, orgId)))
      .limit(1);
    if (rader.length === 0) throw ikkeFunnet("Leverandør");
  }
  if (felt.unitId) {
    const rader = await db
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.id, felt.unitId), eq(units.orgId, orgId)))
      .limit(1);
    if (rader.length === 0) throw ikkeFunnet("Enhet");
  }
}

/** Siste utkvittering per oppgave — én spørring, ikke én per rad. */
async function sisteUtkvitteringer(db: Db, taskIds: string[]): Promise<Map<string, string>> {
  if (taskIds.length === 0) return new Map();
  const rader = await db
    .select({
      taskId: completions.taskId,
      sist: sql<string>`max(${completions.completedAt})::date`,
    })
    .from(completions)
    .where(inArray(completions.taskId, taskIds))
    .groupBy(completions.taskId);
  return new Map(rader.map((r) => [r.taskId, r.sist]));
}

/** Beriker med `lastCompletedAt`, `nesteFrist` og `forsinket` — utledet, aldri lagret. */
function berik<T extends { id: string; frequency: string; active: boolean; startDate: string | null; dueDate: string | null }>(
  rad: T,
  sist: string | null,
) {
  const input = {
    active: rad.active,
    frequency: rad.frequency,
    startDate: rad.startDate,
    dueDate: rad.dueDate,
    lastCompletedAt: sist,
  };
  return { ...rad, lastCompletedAt: sist, nesteFrist: nesteFrist(input), forsinket: erForsinket(input) };
}

export async function hentOppgaver(db: Db, orgId: string) {
  const rader = await db
    .select({
      oppgave: tasks,
      vendorName: vendors.name,
      unitNavn: units.navn,
      ansvarligNavn: users.name,
    })
    .from(tasks)
    .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
    .leftJoin(units, eq(units.id, tasks.unitId))
    .leftJoin(users, eq(users.id, tasks.responsibleUserId))
    .where(eq(tasks.orgId, orgId))
    .orderBy(asc(tasks.title));

  const sist = await sisteUtkvitteringer(db, rader.map((r) => r.oppgave.id));
  return rader.map((r) => ({
    ...berik(r.oppgave, sist.get(r.oppgave.id) ?? null),
    vendorName: r.vendorName,
    unitNavn: r.unitNavn,
    ansvarligNavn: r.ansvarligNavn,
  }));
}

export async function hentOppgave(db: Db, orgId: string, taskId: string) {
  // Joinene MÅ være de samme som i `hentOppgaver`. Uten dem viste detaljsiden «—» for
  // leverandør mens lista viste navnet — samme oppgave, to ulike svar.
  const rader = await db
    .select({
      oppgave: tasks,
      vendorName: vendors.name,
      unitNavn: units.navn,
      ansvarligNavn: users.name,
    })
    .from(tasks)
    .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
    .leftJoin(units, eq(units.id, tasks.unitId))
    .leftJoin(users, eq(users.id, tasks.responsibleUserId))
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .limit(1);
  const rad = rader[0];
  if (!rad) throw ikkeFunnet("Oppgave");
  const oppgave = rad.oppgave;

  const [sjekkliste, utkvitteringer, sist] = await Promise.all([
    db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId)).orderBy(asc(taskChecklistItems.order)),
    db.select().from(completions).where(eq(completions.taskId, taskId)).orderBy(desc(completions.completedAt)),
    sisteUtkvitteringer(db, [taskId]),
  ]);

  return {
    ...berik(oppgave, sist.get(taskId) ?? null),
    vendorName: rad.vendorName,
    unitNavn: rad.unitNavn,
    ansvarligNavn: rad.ansvarligNavn,
    sjekkliste,
    utkvitteringer,
  };
}

export async function opprettOppgave(db: Db, orgId: string, data: z.infer<typeof oppgaveInn>) {
  await krevIEgenOrg(db, orgId, data);
  const [ny] = await db
    .insert(tasks)
    .values({ id: randomUUID(), orgId, qrToken: randomUUID(), ...data })
    .returning();
  return berik(ny!, null);
}

export async function endreOppgave(
  db: Db,
  orgId: string,
  taskId: string,
  data: z.infer<typeof oppgaveEndring>,
) {
  await hentOppgave(db, orgId, taskId);
  await krevIEgenOrg(db, orgId, data);
  const [endret] = await db
    .update(tasks)
    .set(data)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .returning();
  const sist = await sisteUtkvitteringer(db, [taskId]);
  return berik(endret!, sist.get(taskId) ?? null);
}

/** Deaktiverer — sletter aldri. En oppgave med utkvitteringshistorikk skal ikke forsvinne. */
export async function deaktiverOppgave(db: Db, orgId: string, taskId: string) {
  await hentOppgave(db, orgId, taskId);
  const [endret] = await db
    .update(tasks)
    .set({ active: false })
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .returning();
  return endret!;
}

/**
 * Manuell utkvittering fra styret i appen — for oppgaver uten oppgaveark, f.eks. halvårlig
 * vindusvask. `manual: true` gjør at loggen viser kilden ærlig i stedet for å late som den
 * kom fra QR-skjemaet.
 */
export async function registrerUtkvittering(
  db: Db,
  orgId: string,
  taskId: string,
  utfortAv: string,
  data: z.infer<typeof utkvitteringInn>,
) {
  await hentOppgave(db, orgId, taskId);

  const dato = data.completedAt ?? iDag();
  if (dato > iDag()) throw ugyldig("Utført-datoen kan ikke være fram i tid");

  return opprettUtkvittering(db, taskId, utfortAv, data, {
    manuell: true,
    tidspunkt: new Date(`${dato}T12:00:00Z`),
  });
}

/**
 * Selve registreringen. Delt av appen og det anonyme QR-skjemaet — som `create_completion`
 * i v1, og av samme grunn: to nesten like kopier ville drevet fra hverandre, og den ene
 * ville mistet enten sjekklistekopien eller avviksnummeret.
 *
 * Tre ting skjer her, og alle tre er lette å glemme:
 *
 * 1. **Sjekklisten KOPIERES inn** i resultatradene. Malpunktet kan endres eller slettes
 *    senere uten at gammel logg endrer seg — det er hele grunnen til at raden bærer teksten.
 * 2. **Punkter som ikke er huket av føres som `checked: false`**, ikke utelates. «Ikke
 *    utført» og «ikke spurt om» er ulike ting i en internkontrollperm.
 * 3. **Avviket får løpenummer.** I v1 ble avvik meldt via QR opprettet UTEN nummer — de sto
 *    uten i lista og var umulige å finne igjen med nummersøk.
 */
export async function opprettUtkvittering(
  db: Db,
  taskId: string,
  utfortAv: string,
  data: z.infer<typeof utkvitteringInn>,
  opts: { manuell: boolean; tidspunkt?: Date; orgId?: string; avvikstittel?: string },
) {
  const [ny] = await db
    .insert(completions)
    .values({
      id: randomUUID(),
      taskId,
      completedBy: utfortAv,
      ...(opts.tidspunkt ? { completedAt: opts.tidspunkt } : {}),
      manual: opts.manuell,
      notes: data.notes,
      hasDeviation: data.hasDeviation,
      deviationDescription: data.deviationDescription,
    })
    .returning();
  const utkvittering = ny!;

  const mal = await db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId))
    .orderBy(asc(taskChecklistItems.order));

  if (mal.length > 0) {
    const avhuket = new Set(data.checkedItemIds);
    await db.insert(completionChecklistResults).values(
      mal.map((punkt) => ({
        id: randomUUID(),
        completionId: utkvittering.id,
        itemId: punkt.id,
        text: punkt.text,
        checked: avhuket.has(punkt.id),
        order: punkt.order,
      })),
    );
  }

  if (data.hasDeviation) {
    const orgId = opts.orgId ?? (await orgForOppgave(db, taskId));
    const [oppgave] = await db
      .select({ vendorId: tasks.vendorId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    const nummer = await db
      .select({ maks: sql<number | null>`max(${deviations.number})` })
      .from(deviations)
      .where(eq(deviations.orgId, orgId));

    await db.insert(deviations).values({
      id: randomUUID(),
      orgId,
      number: (nummer[0]?.maks ?? 0) + 1,
      taskId,
      completionId: utkvittering.id,
      vendorId: oppgave?.vendorId ?? null,
      title: data.deviationDescription?.trim() || opts.avvikstittel || "Avvik registrert ved utkvittering",
      description: data.deviationDescription ?? null,
      severity: data.severity ?? null,
      reportedBy: utfortAv,
    });
  }

  return utkvittering;
}

/** Org-en en oppgave hører til. Brukes der konteksten kommer fra tokenet, ikke fra URL-en. */
async function orgForOppgave(db: Db, taskId: string): Promise<string> {
  const rader = await db
    .select({ orgId: tasks.orgId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  const org = rader[0]?.orgId;
  if (!org) throw ikkeFunnet("Oppgave");
  return org;
}

/**
 * Erstatter hele sjekklistemalen.
 *
 * Gamle punkter slettes, men utført historikk berøres IKKE: `completion_checklist_results`
 * har sin egen kopi av teksten, og `itemId` er SET NULL. Det er hele grunnen til at
 * resultatraden duplisterer teksten i stedet for å peke på malen.
 */
export async function erstattSjekkliste(
  db: Db,
  orgId: string,
  taskId: string,
  data: z.infer<typeof sjekklisteInn>,
) {
  await hentOppgave(db, orgId, taskId);

  await db.delete(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId));
  if (data.items.length === 0) return [];

  return db
    .insert(taskChecklistItems)
    .values(data.items.map((p, i) => ({ id: randomUUID(), taskId, text: p.text, order: i })))
    .returning();
}

/** Historikken for én utkvittering, med de kopierte sjekkpunktene. */
export async function hentUtkvitteringsresultater(db: Db, completionId: string) {
  return db
    .select()
    .from(completionChecklistResults)
    .where(eq(completionChecklistResults.completionId, completionId))
    .orderBy(asc(completionChecklistResults.order));
}
