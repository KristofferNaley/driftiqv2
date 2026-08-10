/**
 * «Min aktivitet» — hva ÉN person har gjort i ÉN organisasjon, samlet på ett sted.
 *
 * Ny i v2. Dataene har alltid ligget der, men bare per modul: for å se hva du selv har gjort
 * måtte du åpne oppgaver, avvik, driftslogg og internkontroll etter hverandre og lete etter
 * navnet ditt i hver liste.
 *
 * ## Id FØRST, navn bare som reserve
 *
 * Historikkradene bærer nå BÅDE `*_user_id` og navnet (se `lib/aktor.ts`). Oppslaget her går
 * på id-en: da følger aktiviteten din deg gjennom et navnebytte, og to personer med samme navn
 * i samme lag blander seg ikke.
 *
 * Navnetreffet er beholdt som reserve for rader der id-en er NULL, og det er to grunner til at
 * de finnes: rader skrevet før kolonnene kom (bare de entydige ble fylt av backfillen i
 * migrasjon 0031), og rader som aldri kan ha en id — QR-skjemaet er anonymt, og
 * leverandørportalen har ingen konto. Reserven treffer altså bare der id-en ikke kan svare.
 *
 * Vernerundedeltakelse står fortsatt på navn alene: deltakerne skrives inn som fritekst og er
 * ofte verneombud, vaktmester eller en leverandørrepresentant uten konto i systemet. Skal den
 * få id, må runde-skjemaet først få en personvelger.
 *
 * ## Ingen modulgate
 *
 * Ruta setter ikke `modul:`. Dette er personens egen historikk på tvers av moduler, og en
 * modul som er slått av i dag skal ikke slette det du gjorde mens den var på. Modulgaten
 * styrer hvilke SIDER laget har, ikke hvem du har vært.
 */

import { and, eq, gte, isNull, or, sql, type AnyColumn } from "drizzle-orm";
import type { Db } from "../db/client";
// Typene og etikettene ligger i en ren fil UTEN importer — profilmodalen leser dem også, og
// en klientkomponent som rører denne fila drar pg-driveren inn i nettleserbundlet.
import { AKTIVITETSSLAG, type Aktivitetsslag, type Hendelse, type MinAktivitet } from "./aktivitetsslag";
import { deviations, deviationTreatments } from "../db/schema/avvik";
import { logEntries } from "../db/schema/driftslogg";
import {
  hmsGoalApprovals,
  hmsGoals,
  safetyRoundParticipants,
  safetyRounds,
} from "../db/schema/internkontroll";
import { completions, tasks } from "../db/schema/tasks";
import { unitWorks } from "../db/schema/vedlikehold";

/** Ett år tilbake. Lenger tilbake er ikke «aktivitet» lenger, det er arkiv. */
const DAGER = 365;

/**
 * «Dette er min rad»: id-en treffer meg, ELLER raden har ingen id og navnet treffer.
 *
 * Rekkefølgen er hele poenget. Har raden en id, er den sannheten — også når navnet på raden er
 * et annet, fordi personen har byttet navn siden. Bare når id-en mangler faller vi tilbake på
 * navnet, og da med `btrim`/`lower` på begge sider: manuelt innskrevne navn har etterslepende
 * mellomrom oftere enn man tror, og Enhetsregisteret leverer en del navn i store bokstaver (se
 * `normaliserNavnedel` i brreg.ts).
 */
const somMeg = (idKolonne: AnyColumn, navnKolonne: AnyColumn, brukerId: string, navn: string) =>
  or(
    eq(idKolonne, brukerId),
    and(isNull(idKolonne), sql`lower(btrim(${navnKolonne})) = ${navn}`),
  );

/** Der raden aldri kan få en id — vernerundedeltakere. Se filkommentaren. */
const somNavn = (kolonne: AnyColumn, navn: string) => sql`lower(btrim(${kolonne})) = ${navn}`;

export async function hentMinAktivitet(
  db: Db,
  orgId: string,
  bruker: { id: string; name: string },
): Promise<MinAktivitet> {
  const navn = bruker.name.trim().toLowerCase();
  const fraTid = new Date(Date.now() - DAGER * 86_400_000);
  // `date`-kolonner sammenlignes med en datostreng, ikke et tidspunkt.
  const fraDato = fraTid.toISOString().slice(0, 10);

  /**
   * SEKVENSIELT, ikke `Promise.all`.
   *
   * De åtte spørringene er uavhengige, så parallelt ser riktigere ut — men de deler ÉN
   * tilkobling inne i én transaksjon, og node-postgres køer overlappende kall på samme
   * klient. Parallelliteten er altså innbilt, og prisen er ekte: pg advarer
   * («client.query() when the client is already executing a query is deprecated») og fjerner
   * oppførselen i pg@9. Fanget av `aktivitet.test.ts`, som skrev advarselen i testloggen.
   */
  const kvitteringer = await db
    .select({
      dato: completions.completedAt,
      tittel: tasks.title,
      taskId: tasks.id,
      notat: completions.notes,
      manuell: completions.manual,
    })
    .from(completions)
    // `completions` har ingen egen org_id — isolasjonen går gjennom `tasks`, både i RLS og her.
    .innerJoin(tasks, eq(tasks.id, completions.taskId))
    .where(
      and(
        eq(tasks.orgId, orgId),
        gte(completions.completedAt, fraTid),
        somMeg(completions.completedByUserId, completions.completedBy, bruker.id, navn),
      ),
    );

  const meldte = await db
    .select({
      dato: deviations.reportedAt,
      tittel: deviations.title,
      id: deviations.id,
      nummer: deviations.number,
      alvor: deviations.severity,
    })
    .from(deviations)
    .where(
      and(
        eq(deviations.orgId, orgId),
        gte(deviations.reportedAt, fraTid),
        somMeg(deviations.reportedByUserId, deviations.reportedBy, bruker.id, navn),
      ),
    );

  const behandlinger = await db
    .select({
      dato: deviationTreatments.createdAt,
      tekst: deviationTreatments.text,
      tittel: deviations.title,
      id: deviations.id,
      nummer: deviations.number,
    })
    .from(deviationTreatments)
    .innerJoin(deviations, eq(deviations.id, deviationTreatments.deviationId))
    .where(
      and(
        eq(deviations.orgId, orgId),
        gte(deviationTreatments.createdAt, fraTid),
        somMeg(deviationTreatments.createdByUserId, deviationTreatments.createdBy, bruker.id, navn),
      ),
    );

  const lukkede = await db
    .select({
      dato: deviations.resolvedAt,
      tittel: deviations.title,
      id: deviations.id,
      nummer: deviations.number,
    })
    .from(deviations)
    .where(
      and(
        eq(deviations.orgId, orgId),
        gte(deviations.resolvedAt, fraTid),
        somMeg(deviations.resolvedByUserId, deviations.resolvedBy, bruker.id, navn),
      ),
    );

  const logg = await db
    .select({ dato: logEntries.entryDate, tittel: logEntries.title, tekst: logEntries.description })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.orgId, orgId),
        gte(logEntries.entryDate, fraDato),
        somMeg(logEntries.createdByUserId, logEntries.createdBy, bruker.id, navn),
      ),
    );

  // Den ENESTE kilden som slås opp på id. Se filkommentaren.
  const signaturer = await db
    .select({ dato: hmsGoalApprovals.signedAt, aar: hmsGoals.year, id: hmsGoals.id })
    .from(hmsGoalApprovals)
    .innerJoin(hmsGoals, eq(hmsGoals.id, hmsGoalApprovals.goalId))
    .where(
      and(
        eq(hmsGoals.orgId, orgId),
        eq(hmsGoalApprovals.userId, bruker.id),
        gte(hmsGoalApprovals.signedAt, fraTid),
      ),
    );

  const runder = await db
    .select({
      dato: safetyRounds.roundDate,
      lagtInn: safetyRoundParticipants.createdAt,
      tittel: safetyRounds.title,
      id: safetyRounds.id,
      rolle: safetyRoundParticipants.role,
    })
    .from(safetyRoundParticipants)
    .innerJoin(safetyRounds, eq(safetyRounds.id, safetyRoundParticipants.roundId))
    .where(
      and(
        eq(safetyRounds.orgId, orgId),
        gte(safetyRoundParticipants.createdAt, fraTid),
        somNavn(safetyRoundParticipants.name, navn),
      ),
    );

  const enhetsarbeid = await db
    .select({
      dato: unitWorks.workDate,
      tittel: unitWorks.title,
      enhet: unitWorks.unitLabel,
      id: unitWorks.id,
    })
    .from(unitWorks)
    .where(
      and(
        eq(unitWorks.orgId, orgId),
        gte(unitWorks.workDate, fraDato),
        somMeg(unitWorks.createdByUserId, unitWorks.createdBy, bruker.id, navn),
      ),
    );

  const nr = (n: number | null) => (n === null ? "" : `#${n} · `);

  const hendelser: Hendelse[] = [
    ...kvitteringer.map((r) => ({
      slag: "oppgave" as const,
      tittel: r.tittel,
      // «Via QR» er ikke pynt: den skiller det du gjorde på stedet fra det du etterregistrerte.
      detalj: r.notat?.trim() || (r.manuell ? "Registrert i appen" : "Kvittert via QR"),
      dato: r.dato.toISOString(),
      sti: `/oppgaver/${r.taskId}`,
    })),
    ...meldte.map((r) => ({
      slag: "avvik" as const,
      tittel: r.tittel,
      detalj: `${nr(r.nummer)}${r.alvor ?? "meldt"}`,
      dato: r.dato.toISOString(),
      sti: `/avvik/${r.id}`,
    })),
    ...behandlinger.map((r) => ({
      slag: "behandling" as const,
      tittel: r.tittel,
      detalj: kort(r.tekst),
      dato: r.dato.toISOString(),
      sti: `/avvik/${r.id}`,
    })),
    // `resolvedAt` er nullbar, men `gte` har alt filtrert bort radene uten verdi.
    ...lukkede.map((r) => ({
      slag: "lukket" as const,
      tittel: r.tittel,
      detalj: `${nr(r.nummer)}lukket`,
      dato: r.dato!.toISOString(),
      sti: `/avvik/${r.id}`,
    })),
    ...logg.map((r) => ({
      slag: "driftslogg" as const,
      tittel: r.tittel,
      detalj: kort(r.tekst),
      dato: r.dato,
      sti: "/driftslogg",
    })),
    ...signaturer.map((r) => ({
      slag: "hms" as const,
      tittel: `HMS-mål ${r.aar}`,
      detalj: "Signert",
      dato: r.dato.toISOString(),
      sti: `/internkontroll/maal/${r.id}`,
    })),
    ...runder.map((r) => ({
      slag: "vernerunde" as const,
      tittel: r.tittel,
      detalj: r.rolle?.trim() || "Deltok",
      // Rundens dato når den er satt; ellers da deltakelsen ble registrert.
      dato: r.dato ?? r.lagtInn.toISOString(),
      sti: `/internkontroll/vernerunde/${r.id}`,
    })),
    ...enhetsarbeid.map((r) => ({
      slag: "enhetsarbeid" as const,
      tittel: r.tittel,
      detalj: r.enhet,
      dato: r.dato,
      sti: "/vedlikehold",
    })),
  ].sort((a, b) => (a.dato < b.dato ? 1 : a.dato > b.dato ? -1 : 0));

  const antall = Object.fromEntries(AKTIVITETSSLAG.map((s) => [s, 0])) as Record<
    Aktivitetsslag,
    number
  >;
  for (const h of hendelser) antall[h.slag]++;

  return { hendelser, antall, navn: bruker.name, fra: fraDato };
}

/**
 * Fritekst er ofte et helt avsnitt. Raden har plass til én linje, og klipper resten med CSS —
 * dette kuttet er for å slippe å sende avsnittet over nettet i det hele tatt.
 */
function kort(tekst: string | null): string | null {
  const rent = tekst?.trim();
  if (!rent) return null;
  const enLinje = rent.replace(/\s+/gu, " ");
  return enLinje.length > 70 ? `${enLinje.slice(0, 69)}…` : enLinje;
}
