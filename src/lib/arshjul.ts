/**
 * Årshjul — validering og forretningsregler. Port av v1s `routers/arshjul.py`.
 */

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { annualEvents } from "../db/schema/arshjul";
import { hmsGoals, safetyRounds } from "../db/schema/internkontroll";
import { hentOppgaver } from "./oppgaver";
import { ikkeFunnet, ugyldig } from "./api";

// Kategoriene ligger i en importfri fil — klientsiden trenger dem. Se kommentaren der.
export { KATEGORIER, HJULKATEGORIER } from "./arshjulkategorier";
import { HJULKATEGORIER, KATEGORIER } from "./arshjulkategorier";

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

// ---------------------------------------------------------------------------------------
// Selve hjulet
// ---------------------------------------------------------------------------------------

export type Hjulhendelse = {
  id: string;
  tittel: string;
  under: string;
  kategori: keyof typeof HJULKATEGORIER;
  dato: string;
  startDato: string | null;
  /** `manuell` kan redigeres og slettes; de andre eies av modulen de kommer fra. */
  kilde: "manuell" | "oppgaver" | "internkontroll";
  gjentas: boolean;
};

/**
 * Alt som skal stå på årshjulet for ett år, fra fire kilder.
 *
 * ## Hvorfor oppgavene må hukes av
 *
 * Et borettslag har gjerne tolv driftsoppgaver som gjentas ukentlig. Legger man dem alle på
 * hjulet, drukner styrets egne frister — generalforsamling, budsjett, HMS — i trappevask.
 * Derfor er `showOnArshjul` av som standard, og hver oppgave må velges inn. Samme valg som
 * v1 tok etter brukertest.
 */
export async function hentArshjul(db: Db, orgId: string, aar: number) {
  const [manuelle, oppgaveliste, runder, maal] = await Promise.all([
    hentHendelser(db, orgId),
    hentOppgaver(db, orgId),
    db
      .select({ id: safetyRounds.id, title: safetyRounds.title, roundDate: safetyRounds.roundDate })
      .from(safetyRounds)
      .where(eq(safetyRounds.orgId, orgId)),
    db
      .select({ id: hmsGoals.id, periodEnd: hmsGoals.periodEnd })
      .from(hmsGoals)
      .where(and(eq(hmsGoals.orgId, orgId), eq(hmsGoals.year, aar)))
      .limit(1),
  ]);

  const hendelser: Hjulhendelse[] = [];

  for (const o of oppgaveliste) {
    if (!o.showOnArshjul || !o.nesteFrist) continue;
    hendelser.push({
      id: `oppgave-${o.id}`,
      tittel: o.title,
      under: o.vendorName ?? "",
      kategori: "oppgave",
      dato: o.nesteFrist,
      startDato: null,
      kilde: "oppgaver",
      gjentas: true,
    });
  }

  for (const r of runder) {
    if (!r.roundDate) continue;
    hendelser.push({
      id: `runde-${r.id}`,
      tittel: `${r.title} — frist`,
      under: "§ 5 internkontroll",
      kategori: "hms",
      dato: r.roundDate,
      startDato: null,
      kilde: "internkontroll",
      gjentas: false,
    });
  }

  if (maal[0]?.periodEnd) {
    hendelser.push({
      id: `hmsmaal-${maal[0].id}`,
      tittel: "HMS-mål fornyes",
      under: "Årlig fornyelse",
      kategori: "hms",
      dato: maal[0].periodEnd,
      startDato: null,
      kilde: "internkontroll",
      gjentas: true,
    });
  }

  for (const m of manuelle) {
    hendelser.push({
      id: m.id,
      tittel: m.title,
      under: m.description ?? "",
      kategori: (m.category in HJULKATEGORIER
        ? m.category
        : "annet") as keyof typeof HJULKATEGORIER,
      dato: m.eventDate,
      // Bare manuelle hendelser kan ha en periode — de automatiske kildene er enkeltdatoer.
      startDato: m.startDate,
      kilde: "manuell",
      gjentas: m.isRecurring,
    });
  }

  /**
   * Sorteres på måned og dag, IKKE på full dato.
   *
   * En gjentakende hendelse har datoen fra året den ble lagt inn, og en oppgave har sitt
   * neste forfall — som kan ligge i fjor eller neste år. Hjulet viser ett år om gangen, og
   * da er det plasseringen i året som gjelder, ikke hvilket år datoen tilfeldigvis bærer.
   */
  hendelser.sort((a, b) => a.dato.slice(5).localeCompare(b.dato.slice(5)));

  return {
    aar,
    hendelser,
    /** Oppgavene som KAN vises, med dagens valg — til avkryssingslista i høyremenyen. */
    oppgavevalg: oppgaveliste.map((o) => ({
      id: o.id,
      tittel: o.title,
      frekvens: o.frequency,
      leverandor: o.vendorName ?? null,
      vises: o.showOnArshjul,
    })),
  };
}
