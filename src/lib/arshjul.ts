/**
 * Årshjul — validering og forretningsregler. Port av v1s `routers/arshjul.py`.
 */

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { annualEvents } from "../db/schema/arshjul";
import { ikkeFunnet, ugyldig } from "./api";

export const KATEGORIER = ["dugnad", "budsjett", "frist", "annet"] as const;

export const hendelseInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  category: z.enum(KATEGORIER).default("annet"),
  startDate: z.string().date().nullish(),
  eventDate: z.string().date(),
  isRecurring: z.boolean().default(false),
});

export const hendelseEndring = hendelseInn.partial();

/** Startdato kan ikke ligge etter fristen. `eventDate` er alltid slutten av perioden. */
function validerPeriode(startDate: string | null | undefined, eventDate: string | null | undefined) {
  if (startDate && eventDate && startDate > eventDate) {
    throw ugyldig("Startdato kan ikke være etter fristen");
  }
}

export async function hentHendelser(db: Db, orgId: string) {
  return db
    .select()
    .from(annualEvents)
    .where(eq(annualEvents.orgId, orgId))
    .orderBy(asc(annualEvents.eventDate));
}

export async function opprettHendelse(db: Db, orgId: string, data: z.infer<typeof hendelseInn>) {
  validerPeriode(data.startDate, data.eventDate);
  const [ny] = await db
    .insert(annualEvents)
    .values({ id: randomUUID(), orgId, ...data })
    .returning();
  return ny!;
}

export async function endreHendelse(
  db: Db,
  orgId: string,
  eventId: string,
  data: z.infer<typeof hendelseEndring>,
) {
  const rader = await db
    .select()
    .from(annualEvents)
    .where(and(eq(annualEvents.id, eventId), eq(annualEvents.orgId, orgId)))
    .limit(1);
  const hendelse = rader[0];
  if (!hendelse) throw ikkeFunnet("Hendelse");

  // Validér den KOMBINERTE tilstanden, ikke bare det som ble sendt inn — en oppdatering som
  // bare flytter fristen kan ellers legge den foran en eksisterende startdato.
  validerPeriode(
    data.startDate === undefined ? hendelse.startDate : data.startDate,
    data.eventDate === undefined ? hendelse.eventDate : data.eventDate,
  );

  const [endret] = await db
    .update(annualEvents)
    .set(data)
    .where(and(eq(annualEvents.id, eventId), eq(annualEvents.orgId, orgId)))
    .returning();
  return endret!;
}

export async function slettHendelse(db: Db, orgId: string, eventId: string) {
  const rader = await db
    .select({ id: annualEvents.id })
    .from(annualEvents)
    .where(and(eq(annualEvents.id, eventId), eq(annualEvents.orgId, orgId)))
    .limit(1);
  if (rader.length === 0) throw ikkeFunnet("Hendelse");

  await db
    .delete(annualEvents)
    .where(and(eq(annualEvents.id, eventId), eq(annualEvents.orgId, orgId)));
}
