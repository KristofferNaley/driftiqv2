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
import type { Aktor } from "./aktor";

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

  const [sjekkliste, radene, sist] = await Promise.all([
    db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId)).orderBy(asc(taskChecklistItems.order)),
    // Utførerens nåværende navn når utkvitteringen har en bruker-id; ellers navnet som ble
    // ført — for QR-utkvitteringer er det ofte et leverandørnavn og aldri en konto.
    db
      .select({ u: completions, utforerNavn: users.name })
      .from(completions)
      .leftJoin(users, eq(users.id, completions.completedByUserId))
      .where(eq(completions.taskId, taskId))
      .orderBy(desc(completions.completedAt))
      .then((rader) =>
        rader.map((r) => ({ ...r.u, completedBy: r.utforerNavn ?? r.u.completedBy })),
      ),
    sisteUtkvitteringer(db, [taskId]),
  ]);

  /**
   * Sjekkpunktene SOM DE STO ved hver utførelse — kopien i `completion_checklist_results`,
   * ikke dagens mal.
   *
   * Dette er hele grunnen til at tabellen finnes, og v2 lagret dem uten å vise dem noe sted:
   * loggen sa «utført» og ingenting om HVA som ble gjort. For en internkontrollperm er det
   * forskjellen på en kvittering og en dokumentasjon — «3 av 3 punkter huket av, ett av dem var
   * brannslukker kontrollert» er svaret et tilsyn spør om.
   *
   * ÉN spørring for alle utførelsene, ikke én per rad: en oppgave med ukentlig frekvens har
   * hundrevis av dem etter noen år.
   */
  const resultater =
    radene.length === 0
      ? []
      : await db
          .select()
          .from(completionChecklistResults)
          .where(inArray(completionChecklistResults.completionId, radene.map((u) => u.id)))
          .orderBy(asc(completionChecklistResults.order));

  const perUtkvittering = new Map<string, typeof resultater>();
  for (const r of resultater) {
    const liste = perUtkvittering.get(r.completionId) ?? [];
    liste.push(r);
    perUtkvittering.set(r.completionId, liste);
  }

  return {
    ...berik(oppgave, sist.get(taskId) ?? null),
    vendorName: rad.vendorName,
    unitNavn: rad.unitNavn,
    ansvarligNavn: rad.ansvarligNavn,
    sjekkliste,
    utkvitteringer: radene.map((u) => ({ ...u, punkter: perUtkvittering.get(u.id) ?? [] })),
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
  utfortAv: Aktor,
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
  /** Navn OG id: navnet føres i protokollen, id-en gjør raden søkbar per person. Se aktor.ts. */
  utfortAv: Aktor,
  data: z.infer<typeof utkvitteringInn>,
  opts: { manuell: boolean; tidspunkt?: Date; orgId?: string; avvikstittel?: string },
) {
  // Leverandøren fryses PÅ raden, ikke utledet ved lesing: `tasks.vendorId` sier hvem som har
  // avtalen nå, og et leverandørbytte skal ikke omskrive hvem som utførte gamle jobber.
  const [oppgaverad] = await db
    .select({ vendorId: tasks.vendorId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  const [ny] = await db
    .insert(completions)
    .values({
      id: randomUUID(),
      taskId,
      completedBy: utfortAv.navn,
      completedByUserId: utfortAv.brukerId,
      vendorId: oppgaverad?.vendorId ?? null,
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
    // Samme leverandør som utkvitteringen fikk — slått opp én gang, over.
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
      vendorId: oppgaverad?.vendorId ?? null,
      title: data.deviationDescription?.trim() || opts.avvikstittel || "Avvik registrert ved utkvittering",
      description: data.deviationDescription ?? null,
      severity: data.severity ?? null,
      reportedBy: utfortAv.navn,
      reportedByUserId: utfortAv.brukerId,
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
 * Oppdaterer sjekklistemalen og BEHOLDER id-en på punkter som fortsatt finnes.
 *
 * ## Hvorfor dette ikke er «slett alt og sett inn på nytt»
 *
 * Det var nettopp det den gjorde før, og prisen var usynlig: hver redigering ga alle punktene
 * nye UUID-er, `completion_checklist_results.itemId` ble `SET NULL` for ALL historikk — også
 * for punktene du ikke rørte — og «har «Gangveier strødd» blitt huket av de siste ti gangene?»
 * kunne ikke besvares på annet enn tekstmatch. Å rette en skrivefeil i én linje kostet altså
 * sporbarheten til hele lista.
 *
 * Teksten kopieres fortsatt inn i resultatraden, og det skal den: den er protokollen for hva
 * som sto der DA jobben ble gjort. Id-en er søkenøkkelen. Samme skille som for aktørene i
 * `lib/aktor.ts` — begge trengs, ingen av dem kan utledes av den andre i ettertid.
 *
 * ## Regelen er med vilje så enkel som den kan være: UENDRET tekst beholder id-en
 *
 * Punkter med nøyaktig samme tekst som før beholder id-en sin, uansett rekkefølge. Alt annet er
 * et nytt punkt med ny id, og den gamle historikken beholder sin egen tekst med `itemId = NULL`.
 *
 * Det betyr at et NAVNEBYTTE nullstiller punktets statistikk — og det er et valg, ikke en
 * mangel. Sjekkpunktene er ofte fysiske ting («Vask 1», «Tørk 3»), og «hvor mange rens har Vask
 * 3 hatt?» er bare til å stole på hvis et punkt aldri kan arve et annets historikk. Enhver
 * gjetning (posisjon, likhet) ville før eller siden gitt en ny maskin den gamles tall. Bytter
 * kunden navn i stedet for å legge til et nytt punkt, er brutt statistikk deres valg — teksten i
 * redigeringsdialogen sier det rett ut.
 */
export async function erstattSjekkliste(
  db: Db,
  orgId: string,
  taskId: string,
  data: z.infer<typeof sjekklisteInn>,
) {
  await hentOppgave(db, orgId, taskId);

  const fra = await db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId))
    .orderBy(asc(taskChecklistItems.order));

  const nokkel = (t: string) => t.trim().toLowerCase();
  const ubrukt = new Map<string, string[]>();
  for (const p of fra) {
    const liste = ubrukt.get(nokkel(p.text)) ?? [];
    liste.push(p.id);
    ubrukt.set(nokkel(p.text), liste);
  }

  // Eksakt tekst er hele regelen. Duplikater («Vask 1» to ganger) kobles i rekkefølge.
  const tildelt: Array<string | null> = data.items.map((p) => {
    const treff = ubrukt.get(nokkel(p.text));
    return treff && treff.length > 0 ? treff.shift()! : null;
  });

  // Det som ikke ble gjenbrukt, finnes ikke lenger i malen. Historikken består: resultatraden
  // har sin egen tekst, og fremmednøkkelen er SET NULL.
  const beholdt = new Set(tildelt.filter((id): id is string => id !== null));
  const skalBort = fra.filter((p) => !beholdt.has(p.id)).map((p) => p.id);
  if (skalBort.length > 0) {
    await db.delete(taskChecklistItems).where(inArray(taskChecklistItems.id, skalBort));
  }

  for (let i = 0; i < data.items.length; i++) {
    const id = tildelt[i];
    const punkt = data.items[i]!;
    if (id) {
      await db
        .update(taskChecklistItems)
        .set({ text: punkt.text, order: i })
        .where(eq(taskChecklistItems.id, id));
    } else {
      await db
        .insert(taskChecklistItems)
        .values({ id: randomUUID(), taskId, text: punkt.text, order: i });
    }
  }

  return db
    .select()
    .from(taskChecklistItems)
    .where(eq(taskChecklistItems.taskId, taskId))
    .orderBy(asc(taskChecklistItems.order));
}

/** Historikken for én utkvittering, med de kopierte sjekkpunktene. */
export async function hentUtkvitteringsresultater(db: Db, completionId: string) {
  return db
    .select()
    .from(completionChecklistResults)
    .where(eq(completionChecklistResults.completionId, completionId))
    .orderBy(asc(completionChecklistResults.order));
}
