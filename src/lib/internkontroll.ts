/**
 * Internkontroll — port av v1s `routers/hms.py`.
 *
 * Fire deler etter internkontrollforskriften § 5 andre ledd: HMS-mål (pkt. 4),
 * ansvarsfordeling (pkt. 5), risikovurdering (pkt. 6) og den årlige evalueringen (pkt. 8),
 * pluss vernerunden.
 *
 * ## Ikke portert ennå
 *
 * - PDF-rapporten fra en fullført vernerunde. Den bruker ReportLab i v1 og må skrives om
 *   for JS — egen runde, sammen med resten av rapportgenereringen.
 */

import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { deviations } from "../db/schema/avvik";
import {
  hazardActions,
  hazards,
  hmsEvaluations,
  hmsGoalApprovals,
  hmsGoals,
  hmsResponsibilities,
  hmsSubGoals,
  safetyRoundItems,
  safetyRoundParticipants,
  safetyRounds,
} from "../db/schema/internkontroll";
import { hmsTemplateCategories, hmsTemplateItems, hmsTemplates } from "../db/schema/maler";
import { users } from "../db/schema/users";
import { ikkeFunnet, ugyldig } from "./api";

/**
 * Områdene er faste. Forskriften krever at ansvaret ER fordelt, ikke at kunden selv skal
 * finne på hvilke områder som finnes — en fritt definerbar liste ville gjort kravet
 * vanskeligere å svare på, ikke lettere.
 */
export const ANSVARSOMRADER = ["brannvern", "el_sikkerhet", "utearealer"] as const;

export const FARESTATUSER = ["open", "mitigated", "closed"] as const;
export const TILTAKSSTATUSER = ["not_started", "in_progress", "done"] as const;
export const RUNDESTATUSER = ["planned", "completed"] as const;

const tekst = z.string().trim().nullish();
/**
 * 1–3, ikke v1s 1–5. Risikovurderingene styrene faktisk gjør (jf. Håsteinsgate 9s gamle
 * skjema) skiller bare tre nivåer, og fem trinn ga falsk presisjon: ingen rader i basen
 * brukte 4 eller 5 da skalaen ble strammet inn.
 */
const skala = z.number().int().min(1).max(3);

export const malInn = z.object({
  year: z.number().int().min(2000).max(2100),
  goalText: z.string().trim().min(1, "Målteksten må fylles ut"),
  periodStart: z.string().date().nullish(),
  periodEnd: z.string().date().nullish(),
  responsibleUserId: z.string().nullish(),
  approved: z.boolean().default(false),
  approvedDate: z.string().date().nullish(),
  approvedMeeting: tekst,
});
export const malEndring = malInn.partial().omit({ year: true });

export const delmalInn = z.object({
  category: tekst,
  text: z.string().trim().min(1, "Delmålet kan ikke være tomt"),
  owner: tekst,
});

export const fareInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  category: tekst,
  description: z.string().nullish(),
  probability: skala,
  consequence: skala,
  owner: tekst,
  status: z.enum(FARESTATUSER).default("open"),
});
export const fareEndring = fareInn.partial();

export const tiltakInn = z.object({
  hazardId: z.string().min(1, "Fare må velges"),
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  status: z.enum(TILTAKSSTATUSER).default("not_started"),
  dueDate: z.string().date().nullish(),
  owner: tekst,
});
export const tiltakEndring = tiltakInn.partial().omit({ hazardId: true });

export const PUNKTSTATUSER = ["ok", "avvik", "ikke_aktuelt"] as const;

export const rundeInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  roundDate: z.string().date().nullish(),
  dueDate: z.string().date().nullish(),
  notes: z.string().nullish(),
  /**
   * Fyller runden med punktene fra en HMS-mal. Uten den kopieres punktene fra lagets
   * FORRIGE runde — det er slik lagets egne tilpasninger følger med videre.
   */
  templateId: z.string().nullish(),
});

export const punktInn = z.object({
  text: z.string().trim().min(1, "Punktet kan ikke være tomt"),
  section: tekst,
});

export const punktEndring = z.object({
  /** null nullstiller til ubesvart. */
  status: z.enum(PUNKTSTATUSER).nullish(),
  checked: z.boolean().optional(),
  notes: z.string().nullish(),
  text: z.string().trim().min(1).optional(),
  section: tekst,
});

export const deltakerInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  role: tekst,
});

export const ansvarInn = z.object({
  area: z.enum(ANSVARSOMRADER),
  personName: tekst,
  note: z.string().nullish(),
});

export const evalueringInn = z.object({
  year: z.number().int().min(2000).max(2100),
  evaluatedDate: z.string().date().nullish(),
  participants: tekst,
  meeting: tekst,
  conclusion: z.string().nullish(),
});
export const evalueringEndring = evalueringInn.partial().omit({ year: true });

// ---------------------------------------------------------------------------------------
// HMS-mål (§ 5 pkt. 4)
// ---------------------------------------------------------------------------------------

export async function hentMal(db: Db, orgId: string) {
  const rader = await db
    .select()
    .from(hmsGoals)
    .where(eq(hmsGoals.orgId, orgId))
    .orderBy(desc(hmsGoals.year));
  return rader;
}

export async function hentEttMal(db: Db, orgId: string, goalId: string) {
  const rader = await db
    .select()
    .from(hmsGoals)
    .where(and(eq(hmsGoals.id, goalId), eq(hmsGoals.orgId, orgId)))
    .limit(1);
  const mal = rader[0];
  if (!mal) throw ikkeFunnet("HMS-mål");

  const [delmal, signaturer] = await Promise.all([
    db.select().from(hmsSubGoals).where(eq(hmsSubGoals.goalId, goalId)).orderBy(asc(hmsSubGoals.createdAt)),
    db
      .select({ signatur: hmsGoalApprovals, navn: users.name })
      .from(hmsGoalApprovals)
      .leftJoin(users, eq(users.id, hmsGoalApprovals.userId))
      .where(eq(hmsGoalApprovals.goalId, goalId))
      .orderBy(asc(hmsGoalApprovals.signedAt)),
  ]);

  return {
    ...mal,
    delmal,
    signaturer: signaturer.map((s) => ({ ...s.signatur, navn: s.navn })),
  };
}

export async function opprettMal(db: Db, orgId: string, data: z.infer<typeof malInn>) {
  const finnes = await db
    .select({ id: hmsGoals.id })
    .from(hmsGoals)
    .where(and(eq(hmsGoals.orgId, orgId), eq(hmsGoals.year, data.year)))
    .limit(1);
  if (finnes.length > 0) throw ugyldig(`Det finnes allerede et HMS-mål for ${data.year}`);

  const [ny] = await db.insert(hmsGoals).values({ id: randomUUID(), orgId, ...data }).returning();
  return ny!;
}

export async function endreMal(db: Db, orgId: string, goalId: string, data: z.infer<typeof malEndring>) {
  await hentEttMal(db, orgId, goalId);
  const [endret] = await db
    .update(hmsGoals)
    .set(data)
    .where(and(eq(hmsGoals.id, goalId), eq(hmsGoals.orgId, orgId)))
    .returning();
  return endret!;
}

export async function slettMal(db: Db, orgId: string, goalId: string) {
  await hentEttMal(db, orgId, goalId);
  await db.delete(hmsGoals).where(and(eq(hmsGoals.id, goalId), eq(hmsGoals.orgId, orgId)));
}

export async function leggTilDelmal(db: Db, orgId: string, goalId: string, data: z.infer<typeof delmalInn>) {
  await hentEttMal(db, orgId, goalId);
  const [ny] = await db.insert(hmsSubGoals).values({ id: randomUUID(), goalId, ...data }).returning();
  return ny!;
}

export async function slettDelmal(db: Db, orgId: string, goalId: string, subId: string) {
  await hentEttMal(db, orgId, goalId);
  const slettet = await db
    .delete(hmsSubGoals)
    .where(and(eq(hmsSubGoals.id, subId), eq(hmsSubGoals.goalId, goalId)))
    .returning({ id: hmsSubGoals.id });
  if (slettet.length === 0) throw ikkeFunnet("Delmål");
}

/**
 * Signerer målet på vegne av seg selv.
 *
 * Signaturen er personlig og kan ikke settes på andres vegne — derfor `brukerId` fra
 * sesjonen og ikke fra kroppen. Én per (mål, bruker): en dobbeltsignatur ville sett ut som
 * to styremedlemmer i dokumentasjonen.
 */
export async function signerMal(db: Db, orgId: string, goalId: string, brukerId: string) {
  await hentEttMal(db, orgId, goalId);
  const finnes = await db
    .select({ id: hmsGoalApprovals.id })
    .from(hmsGoalApprovals)
    .where(and(eq(hmsGoalApprovals.goalId, goalId), eq(hmsGoalApprovals.userId, brukerId)))
    .limit(1);
  if (finnes.length > 0) throw ugyldig("Du har allerede signert dette målet");

  const [ny] = await db
    .insert(hmsGoalApprovals)
    .values({ id: randomUUID(), goalId, userId: brukerId })
    .returning();
  return ny!;
}

export async function fjernSignatur(db: Db, orgId: string, goalId: string, brukerId: string) {
  await hentEttMal(db, orgId, goalId);
  const slettet = await db
    .delete(hmsGoalApprovals)
    .where(and(eq(hmsGoalApprovals.goalId, goalId), eq(hmsGoalApprovals.userId, brukerId)))
    .returning({ id: hmsGoalApprovals.id });
  if (slettet.length === 0) throw ikkeFunnet("Signatur");
}

// ---------------------------------------------------------------------------------------
// Ansvarsfordeling (§ 5 pkt. 5)
// ---------------------------------------------------------------------------------------

export async function hentAnsvar(db: Db, orgId: string) {
  const lagret = await db
    .select()
    .from(hmsResponsibilities)
    .where(eq(hmsResponsibilities.orgId, orgId));

  // Alle områdene returneres alltid, også de uten navn. Et manglende område er nettopp det
  // kunden skal se at de mangler — ikke noe som skjules ved at raden ikke finnes ennå.
  return ANSVARSOMRADER.map((area) => {
    const rad = lagret.find((r) => r.area === area);
    return rad ?? { id: null, orgId, area, personName: null, note: null, updatedAt: null };
  });
}

export async function settAnsvar(db: Db, orgId: string, data: z.infer<typeof ansvarInn>) {
  const [rad] = await db
    .insert(hmsResponsibilities)
    .values({ id: randomUUID(), orgId, ...data })
    .onConflictDoUpdate({
      target: [hmsResponsibilities.orgId, hmsResponsibilities.area],
      set: { personName: data.personName ?? null, note: data.note ?? null, updatedAt: sql`now()` },
    })
    .returning();
  return rad!;
}

// ---------------------------------------------------------------------------------------
// Risikovurdering (§ 5 pkt. 6)
// ---------------------------------------------------------------------------------------

/** Risikotall = sannsynlighet × konsekvens. Utledet, aldri lagret. */
export function risiko(h: { probability: number; consequence: number }): number {
  return h.probability * h.consequence;
}

/**
 * Fargekoden matrisen bruker. Med 1–3-skala er produktene 1, 2, 3, 4, 6 og 9:
 * 1–2 lav, 3–4 middels, 6+ høy — samme inndeling som mockupen og kundens gamle skjema.
 */
export function risikoniva(tall: number): "lav" | "middels" | "hoy" {
  if (tall <= 2) return "lav";
  if (tall <= 4) return "middels";
  return "hoy";
}

export async function hentFarer(db: Db, orgId: string) {
  const rader = await db.select().from(hazards).where(eq(hazards.orgId, orgId));
  const tiltak = await db
    .select()
    .from(hazardActions)
    .where(eq(hazardActions.orgId, orgId))
    .orderBy(asc(hazardActions.dueDate));

  return rader
    .map((h) => ({
      ...h,
      risiko: risiko(h),
      niva: risikoniva(risiko(h)),
      tiltak: tiltak.filter((t) => t.hazardId === h.id),
    }))
    // Høyest risiko først: den listen skal leses ovenfra og ned.
    .sort((a, b) => b.risiko - a.risiko);
}

async function hentFare(db: Db, orgId: string, hazardId: string) {
  const rader = await db
    .select()
    .from(hazards)
    .where(and(eq(hazards.id, hazardId), eq(hazards.orgId, orgId)))
    .limit(1);
  if (!rader[0]) throw ikkeFunnet("Fare");
  return rader[0];
}

export async function opprettFare(db: Db, orgId: string, data: z.infer<typeof fareInn>) {
  const [ny] = await db.insert(hazards).values({ id: randomUUID(), orgId, ...data }).returning();
  return { ...ny!, risiko: risiko(ny!), niva: risikoniva(risiko(ny!)) };
}

export async function endreFare(db: Db, orgId: string, hazardId: string, data: z.infer<typeof fareEndring>) {
  await hentFare(db, orgId, hazardId);
  const [endret] = await db
    .update(hazards)
    .set(data)
    .where(and(eq(hazards.id, hazardId), eq(hazards.orgId, orgId)))
    .returning();
  return { ...endret!, risiko: risiko(endret!), niva: risikoniva(risiko(endret!)) };
}

export async function slettFare(db: Db, orgId: string, hazardId: string) {
  await hentFare(db, orgId, hazardId);
  await db.delete(hazards).where(and(eq(hazards.id, hazardId), eq(hazards.orgId, orgId)));
}

export async function opprettTiltak(db: Db, orgId: string, data: z.infer<typeof tiltakInn>) {
  await hentFare(db, orgId, data.hazardId);
  const [ny] = await db.insert(hazardActions).values({ id: randomUUID(), orgId, ...data }).returning();
  return ny!;
}

export async function endreTiltak(
  db: Db,
  orgId: string,
  actionId: string,
  data: z.infer<typeof tiltakEndring>,
) {
  const [endret] = await db
    .update(hazardActions)
    .set(data)
    .where(and(eq(hazardActions.id, actionId), eq(hazardActions.orgId, orgId)))
    .returning();
  if (!endret) throw ikkeFunnet("Tiltak");
  return endret;
}

export async function slettTiltak(db: Db, orgId: string, actionId: string) {
  const slettet = await db
    .delete(hazardActions)
    .where(and(eq(hazardActions.id, actionId), eq(hazardActions.orgId, orgId)))
    .returning({ id: hazardActions.id });
  if (slettet.length === 0) throw ikkeFunnet("Tiltak");
}

// ---------------------------------------------------------------------------------------
// Vernerunde
// ---------------------------------------------------------------------------------------

/**
 * En fullført runde er LÅST. Den er dokumentasjon på hva som ble observert den dagen, og en
 * runde som kan redigeres i ettertid dokumenterer ingenting.
 */
function krevUlast(runde: { status: string }) {
  if (runde.status === "completed") {
    throw ugyldig("Vernerunden er fullført og låst for endringer");
  }
}

/**
 * De aktive HMS-malene, til malvelgerne i kunde-appen. Malene er plattformdata uten RLS
 * (se maler.ts) — kunden LESER dem her, endre kan bare plattformadmin.
 */
export async function hentHmsMaler(db: Db, type?: string) {
  const betingelser = [eq(hmsTemplates.active, true)];
  if (type) betingelser.push(eq(hmsTemplates.templateType, type));
  return db
    .select({
      id: hmsTemplates.id,
      templateType: hmsTemplates.templateType,
      name: hmsTemplates.name,
      description: hmsTemplates.description,
      isDefault: hmsTemplates.isDefault,
    })
    .from(hmsTemplates)
    .where(and(...betingelser))
    .orderBy(desc(hmsTemplates.isDefault), asc(hmsTemplates.name));
}

/**
 * Kopierer risikovurderingsmalen inn som LAGETS farer — malens punkter blir rader i
 * `hazards` som laget redigerer fritt etterpå. Samme prinsipp som vernerundene: malen er
 * utgangspunktet, laget eier kopien.
 *
 * Sannsynlighet og konsekvens settes til 2/2 («middels» på 1–3-skalaen) med vilje: et
 * startpunkt som tvinger fram en vurdering, ikke en fasit. Farer som alt finnes (samme
 * tittel) hoppes over, så seeding er trygt å kjøre igjen når malen har fått nye områder.
 */
export async function seedFarer(db: Db, orgId: string, templateId: string) {
  const kategorier = await db
    .select()
    .from(hmsTemplateCategories)
    .where(eq(hmsTemplateCategories.templateId, templateId))
    .orderBy(asc(hmsTemplateCategories.order));
  const punkter = await db.select().from(hmsTemplateItems).orderBy(asc(hmsTemplateItems.order));

  const eksisterende = new Set(
    (await db.select({ title: hazards.title }).from(hazards).where(eq(hazards.orgId, orgId))).map(
      (h) => h.title.trim().toLowerCase(),
    ),
  );

  let opprettet = 0;
  let hoppetOver = 0;
  for (const k of kategorier) {
    for (const p of punkter.filter((x) => x.categoryId === k.id)) {
      if (eksisterende.has(p.text.trim().toLowerCase())) {
        hoppetOver++;
        continue;
      }
      eksisterende.add(p.text.trim().toLowerCase());
      await db.insert(hazards).values({
        id: randomUUID(),
        orgId,
        title: p.text,
        category: k.label,
        probability: 2,
        consequence: 2,
        status: "open",
      });
      opprettet++;
    }
  }
  return { opprettet, hoppetOver };
}

export async function hentRunder(db: Db, orgId: string) {
  return db
    .select()
    .from(safetyRounds)
    .where(eq(safetyRounds.orgId, orgId))
    .orderBy(desc(safetyRounds.roundDate));
}

export async function hentRunde(db: Db, orgId: string, roundId: string) {
  const rader = await db
    .select()
    .from(safetyRounds)
    .where(and(eq(safetyRounds.id, roundId), eq(safetyRounds.orgId, orgId)))
    .limit(1);
  const runde = rader[0];
  if (!runde) throw ikkeFunnet("Vernerunde");

  const [punkter, deltakere, avvik] = await Promise.all([
    db.select().from(safetyRoundItems).where(eq(safetyRoundItems.roundId, roundId))
      .orderBy(asc(safetyRoundItems.createdAt)),
    db.select().from(safetyRoundParticipants).where(eq(safetyRoundParticipants.roundId, roundId))
      .orderBy(asc(safetyRoundParticipants.createdAt)),
    db.select().from(deviations).where(and(eq(deviations.roundId, roundId), eq(deviations.orgId, orgId)))
      .orderBy(asc(deviations.number)),
  ]);

  return { ...runde, punkter, deltakere, avvik };
}

/**
 * Oppretter runden, eventuelt fylt med punktene fra en HMS-mal.
 *
 * Punktene KOPIERES inn — de peker ikke på malen. Endres malen etterpå, skal en gjennomført
 * runde fortsatt vise hva som faktisk ble sjekket. Samme prinsipp som sjekklisteresultater
 * på oppgaver.
 */
export async function opprettRunde(db: Db, orgId: string, data: z.infer<typeof rundeInn>) {
  const { templateId, ...felter } = data;
  const [ny] = await db.insert(safetyRounds).values({ id: randomUUID(), orgId, ...felter }).returning();

  if (templateId) {
    const kategorier = await db
      .select()
      .from(hmsTemplateCategories)
      .where(eq(hmsTemplateCategories.templateId, templateId))
      .orderBy(asc(hmsTemplateCategories.order));

    if (kategorier.length > 0) {
      const punkter = await db
        .select()
        .from(hmsTemplateItems)
        .orderBy(asc(hmsTemplateItems.order));

      const rader = kategorier.flatMap((k) =>
        punkter
          .filter((p) => p.categoryId === k.id)
          .map((p) => ({ id: randomUUID(), roundId: ny!.id, text: p.text, section: k.label })),
      );
      if (rader.length > 0) await db.insert(safetyRoundItems).values(rader);
    }
  } else {
    /**
     * Uten mal kopieres punktene fra lagets FORRIGE runde — tekst og seksjon, aldri svar.
     * Det er slik lagets egne tilpasninger (punkter lagt til eller fjernet) blir varige:
     * malen er utgangspunktet for den FØRSTE runden, deretter eier laget sin egen liste.
     */
    const forrige = await db
      .select({ id: safetyRounds.id })
      .from(safetyRounds)
      .where(and(eq(safetyRounds.orgId, orgId), ne(safetyRounds.id, ny!.id)))
      .orderBy(desc(safetyRounds.createdAt))
      .limit(1);
    if (forrige[0]) {
      const punkter = await db
        .select()
        .from(safetyRoundItems)
        .where(eq(safetyRoundItems.roundId, forrige[0].id))
        .orderBy(asc(safetyRoundItems.createdAt));
      if (punkter.length > 0) {
        await db.insert(safetyRoundItems).values(
          punkter.map((p) => ({ id: randomUUID(), roundId: ny!.id, text: p.text, section: p.section })),
        );
      }
    }
  }
  return hentRunde(db, orgId, ny!.id);
}

export async function leggTilPunkt(
  db: Db,
  orgId: string,
  roundId: string,
  data: z.infer<typeof punktInn>,
) {
  const runde = await hentRunde(db, orgId, roundId);
  krevUlast(runde);
  const [ny] = await db
    .insert(safetyRoundItems)
    .values({ id: randomUUID(), roundId, ...data })
    .returning();
  return ny!;
}

export async function slettPunkt(db: Db, orgId: string, roundId: string, itemId: string) {
  const runde = await hentRunde(db, orgId, roundId);
  krevUlast(runde);
  const slettet = await db
    .delete(safetyRoundItems)
    .where(and(eq(safetyRoundItems.id, itemId), eq(safetyRoundItems.roundId, roundId)))
    .returning({ id: safetyRoundItems.id });
  if (slettet.length === 0) throw ikkeFunnet("Sjekkpunkt");
}

export async function endrePunkt(
  db: Db,
  orgId: string,
  roundId: string,
  itemId: string,
  data: z.infer<typeof punktEndring>,
) {
  const runde = await hentRunde(db, orgId, roundId);
  krevUlast(runde);

  // `checked` holdes i takt med statusen — eldre lesere av kolonnen skal ikke se en
  // annen sannhet enn den nye trestatusen forteller.
  const patch: Record<string, unknown> = { ...data };
  if (data.status !== undefined) patch.checked = data.status === "ok";

  const [endret] = await db
    .update(safetyRoundItems)
    .set(patch)
    .where(and(eq(safetyRoundItems.id, itemId), eq(safetyRoundItems.roundId, roundId)))
    .returning();
  if (!endret) throw ikkeFunnet("Sjekkpunkt");
  return endret;
}

export async function leggTilDeltaker(
  db: Db,
  orgId: string,
  roundId: string,
  data: z.infer<typeof deltakerInn>,
) {
  const runde = await hentRunde(db, orgId, roundId);
  krevUlast(runde);
  const [ny] = await db
    .insert(safetyRoundParticipants)
    .values({ id: randomUUID(), roundId, ...data })
    .returning();
  return ny!;
}

export async function slettDeltaker(db: Db, orgId: string, roundId: string, deltakerId: string) {
  const runde = await hentRunde(db, orgId, roundId);
  krevUlast(runde);
  const slettet = await db
    .delete(safetyRoundParticipants)
    .where(and(eq(safetyRoundParticipants.id, deltakerId), eq(safetyRoundParticipants.roundId, roundId)))
    .returning({ id: safetyRoundParticipants.id });
  if (slettet.length === 0) throw ikkeFunnet("Deltaker");
}

/** Fullfører og låser runden. Én vei — den kan ikke gjenåpnes. */
export async function fullforRunde(db: Db, orgId: string, roundId: string) {
  const runde = await hentRunde(db, orgId, roundId);
  krevUlast(runde);

  const [endret] = await db
    .update(safetyRounds)
    .set({ status: "completed" })
    .where(and(eq(safetyRounds.id, roundId), eq(safetyRounds.orgId, orgId)))
    .returning();
  return endret!;
}

export async function slettRunde(db: Db, orgId: string, roundId: string) {
  const runde = await hentRunde(db, orgId, roundId);
  krevUlast(runde);
  await db.delete(safetyRounds).where(and(eq(safetyRounds.id, roundId), eq(safetyRounds.orgId, orgId)));
}

// ---------------------------------------------------------------------------------------
// Årlig evaluering (§ 5 pkt. 8)
// ---------------------------------------------------------------------------------------

export async function hentEvalueringer(db: Db, orgId: string) {
  return db
    .select()
    .from(hmsEvaluations)
    .where(eq(hmsEvaluations.orgId, orgId))
    .orderBy(desc(hmsEvaluations.year));
}

export async function opprettEvaluering(db: Db, orgId: string, data: z.infer<typeof evalueringInn>) {
  const finnes = await db
    .select({ id: hmsEvaluations.id })
    .from(hmsEvaluations)
    .where(and(eq(hmsEvaluations.orgId, orgId), eq(hmsEvaluations.year, data.year)))
    .limit(1);
  if (finnes.length > 0) throw ugyldig(`Det finnes allerede en evaluering for ${data.year}`);

  const [ny] = await db.insert(hmsEvaluations).values({ id: randomUUID(), orgId, ...data }).returning();
  return ny!;
}

export async function endreEvaluering(
  db: Db,
  orgId: string,
  evalId: string,
  data: z.infer<typeof evalueringEndring>,
) {
  const [endret] = await db
    .update(hmsEvaluations)
    .set(data)
    .where(and(eq(hmsEvaluations.id, evalId), eq(hmsEvaluations.orgId, orgId)))
    .returning();
  if (!endret) throw ikkeFunnet("Evaluering");
  return endret;
}

export async function slettEvaluering(db: Db, orgId: string, evalId: string) {
  const slettet = await db
    .delete(hmsEvaluations)
    .where(and(eq(hmsEvaluations.id, evalId), eq(hmsEvaluations.orgId, orgId)))
    .returning({ id: hmsEvaluations.id });
  if (slettet.length === 0) throw ikkeFunnet("Evaluering");
}

/** Status for hele internkontrollen — det § 5-punktene krever, og om de er dekket. */
export async function status(db: Db, orgId: string) {
  const iAar = new Date().getFullYear();
  const [mal, ansvar, farer, runder, evaluering] = await Promise.all([
    db.select({ n: count() }).from(hmsGoals).where(and(eq(hmsGoals.orgId, orgId), eq(hmsGoals.year, iAar))),
    hentAnsvar(db, orgId),
    db.select({ n: count() }).from(hazards).where(eq(hazards.orgId, orgId)),
    db.select({ n: count() }).from(safetyRounds)
      .where(and(eq(safetyRounds.orgId, orgId), eq(safetyRounds.status, "completed"))),
    db.select({ n: count() }).from(hmsEvaluations)
      .where(and(eq(hmsEvaluations.orgId, orgId), eq(hmsEvaluations.year, iAar))),
  ]);

  return {
    aar: iAar,
    maalSatt: (mal[0]?.n ?? 0) > 0,
    ansvarFordelt: ansvar.every((a) => Boolean(a.personName)),
    risikoKartlagt: (farer[0]?.n ?? 0) > 0,
    vernerundeGjennomfort: (runder[0]?.n ?? 0) > 0,
    evaluert: (evaluering[0]?.n ?? 0) > 0,
  };
}
