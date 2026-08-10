/**
 * Driftslogg — lagets kronologiske dagbok. Port av v1s `routers/driftslogg.py`.
 *
 * ## Loggen SAMLES ved lesing, den dupliseres ikke ved skriving
 *
 * Bare de manuelle notatene har egne rader her. Resten — utkvitterte oppgaver, meldte og
 * lukkede avvik, vedlikehold og fullførte vernerunder — leses fra sine egne tabeller og
 * flettes i `hentDriftsloggSamlet`. Alternativet, å skrive en loggrad ved hver hendelse, gir
 * to sannheter som driver fra hverandre: rettes en utkvittering, står loggkopien igjen og
 * lyver. Kildene EIER sine hendelser; loggen er et vindu.
 *
 * Aktørnavn slås opp gjennom `*_user_id` der id-en finnes, så et navnebytte ikke gir feil
 * visning — snapshotet i navnekolonnen er reserven, samme regel som overalt ellers.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { deviations } from "../db/schema/avvik";
import { logEntries } from "../db/schema/driftslogg";
import { safetyRounds } from "../db/schema/internkontroll";
import { completions, tasks } from "../db/schema/tasks";
import { users } from "../db/schema/users";
import { buildingElements, elementServices, unitWorks } from "../db/schema/vedlikehold";
import { vendors } from "../db/schema/vendors";
import { ikkeFunnet } from "./api";
import type { Aktor } from "./aktor";
import { LOGGKILDER, type Driftslogg, type Loggkilde, type Loggpost } from "./driftsloggslag";

export const loggInn = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut"),
  description: z.string().nullish(),
  entryDate: z.string().date(),
  vendorId: z.string().nullish(),
});

export async function hentLogg(db: Db, orgId: string) {
  return db
    .select({
      logg: logEntries,
      vendorName: vendors.name,
      forfatterNavn: users.name,
    })
    .from(logEntries)
    .leftJoin(vendors, eq(vendors.id, logEntries.vendorId))
    // Forfatterens NÅVÆRENDE navn vinner når raden har en id. Snapshotet i `created_by` blir
    // stående i basen — det er reserven for rader uten id, ikke fasiten når vi vet bedre.
    .leftJoin(users, eq(users.id, logEntries.createdByUserId))
    .where(eq(logEntries.orgId, orgId))
    .orderBy(desc(logEntries.entryDate), desc(logEntries.createdAt))
    .then((rader) =>
      rader.map((r) => ({
        ...r.logg,
        createdBy: r.forfatterNavn ?? r.logg.createdBy,
        vendorName: r.vendorName,
      })),
    );
}

export async function opprettLogg(
  db: Db,
  orgId: string,
  forfatter: Aktor,
  data: z.infer<typeof loggInn>,
) {
  // Fremmednøkkelen må peke inn i SAMME org. RLS ville også stoppet en leverandør fra en
  // annen kunde, men da med en fremmednøkkelfeil i stedet for en forståelig 404 — og
  // valideringen er dokumentert som et krav for hvert org-endepunkt.
  if (data.vendorId) {
    const rader = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, data.vendorId), eq(vendors.orgId, orgId)))
      .limit(1);
    if (rader.length === 0) throw ikkeFunnet("Leverandør");
  }

  const [ny] = await db
    .insert(logEntries)
    .values({
      id: randomUUID(),
      orgId,
      createdBy: forfatter.navn,
      createdByUserId: forfatter.brukerId,
      ...data,
    })
    .returning();
  return ny!;
}

export async function slettLogg(db: Db, orgId: string, entryId: string) {
  const rader = await db
    .select({ id: logEntries.id })
    .from(logEntries)
    .where(and(eq(logEntries.id, entryId), eq(logEntries.orgId, orgId)))
    .limit(1);
  if (rader.length === 0) throw ikkeFunnet("Loggføring");

  await db.delete(logEntries).where(and(eq(logEntries.id, entryId), eq(logEntries.orgId, orgId)));
}

// ---------------------------------------------------------------------------------------
// Den samlede loggen
// ---------------------------------------------------------------------------------------

/** Fritekst klippes til én linje FØR den sendes — raden har ikke plass til et avsnitt. */
function enLinje(tekst: string | null | undefined): string | null {
  const rent = tekst?.trim().replace(/\s+/gu, " ");
  if (!rent) return null;
  return rent.length > 120 ? `${rent.slice(0, 119)}…` : rent;
}

/**
 * Hele driftsloggen for org-en, flettet fra fem kilder og sortert nyeste først.
 *
 * Sekvensielle spørringer, ikke `Promise.all` — de deler én transaksjonstilkobling, og
 * node-postgres køer overlappende kall (samme lærdom som i `lib/aktivitet.ts`).
 *
 * Ingen tidsavgrensning: tabellene er org-scopet og små i denne domenetypen, og loggen er
 * nettopp stedet man leter etter «når byttet vi egentlig det sluket?» tre år senere.
 */
export async function hentDriftsloggSamlet(db: Db, orgId: string): Promise<Driftslogg> {
  const utforer = alias(users, "utforer");

  // Utkvitteringer — «Snørydding og strøing fullført». Leverandøren er snapshotet på raden
  // når det finnes (nye rader), ellers oppgavens nåværende (gamle rader mangler snapshot,
  // og et navn er bedre enn et tomt felt selv om laget kan ha byttet leverandør siden).
  const kvitteringsVendor = alias(vendors, "kvitterings_vendor");
  const kvitteringer = await db
    .select({
      id: completions.id,
      nar: completions.completedAt,
      tittel: tasks.title,
      taskId: tasks.id,
      notat: completions.notes,
      navn: completions.completedBy,
      naaNavn: utforer.name,
      vendorNaa: vendors.name,
      vendorDa: kvitteringsVendor.name,
    })
    .from(completions)
    .innerJoin(tasks, eq(tasks.id, completions.taskId))
    .leftJoin(utforer, eq(utforer.id, completions.completedByUserId))
    .leftJoin(vendors, eq(vendors.id, tasks.vendorId))
    .leftJoin(kvitteringsVendor, eq(kvitteringsVendor.id, completions.vendorId))
    .where(eq(tasks.orgId, orgId));

  const melder = alias(users, "melder");
  const lukker = alias(users, "lukker");
  const avvikRader = await db
    .select({
      id: deviations.id,
      nummer: deviations.number,
      tittel: deviations.title,
      meldt: deviations.reportedAt,
      meldtAv: deviations.reportedBy,
      meldtAvNaa: melder.name,
      lukket: deviations.resolvedAt,
      lukketAv: deviations.resolvedBy,
      lukketAvNaa: lukker.name,
      losning: deviations.resolutionNotes,
      vendorNavn: vendors.name,
    })
    .from(deviations)
    .leftJoin(melder, eq(melder.id, deviations.reportedByUserId))
    .leftJoin(lukker, eq(lukker.id, deviations.resolvedByUserId))
    .leftJoin(vendors, eq(vendors.id, deviations.vendorId))
    .where(eq(deviations.orgId, orgId));

  // Vedlikehold er to tabeller: service på bygningsdeler, og arbeid i enkeltenheter.
  const servicer = await db
    .select({
      id: elementServices.id,
      nar: elementServices.serviceDate,
      tittel: elementServices.title,
      elementNavn: buildingElements.name,
      elementId: buildingElements.id,
      utfortAv: elementServices.performedBy,
      notat: elementServices.notes,
    })
    .from(elementServices)
    .innerJoin(buildingElements, eq(buildingElements.id, elementServices.elementId))
    .where(eq(elementServices.orgId, orgId));

  const registrator = alias(users, "registrator");
  const enhetsarbeid = await db
    .select({
      id: unitWorks.id,
      nar: unitWorks.workDate,
      tittel: unitWorks.title,
      enhet: unitWorks.unitLabel,
      utfortAv: unitWorks.performedBy,
      navn: unitWorks.createdBy,
      naaNavn: registrator.name,
      vendorNavn: vendors.name,
    })
    .from(unitWorks)
    .leftJoin(registrator, eq(registrator.id, unitWorks.createdByUserId))
    .leftJoin(vendors, eq(vendors.id, unitWorks.vendorId))
    .where(eq(unitWorks.orgId, orgId));

  // Bare FULLFØRTE runder. En planlagt runde har ikke skjedd, og loggen er dagbok, ikke plan.
  const runder = await db
    .select({ id: safetyRounds.id, nar: safetyRounds.roundDate, tittel: safetyRounds.title })
    .from(safetyRounds)
    .where(and(eq(safetyRounds.orgId, orgId), eq(safetyRounds.status, "completed"), isNotNull(safetyRounds.roundDate)));

  const forfatter = alias(users, "forfatter");
  const notater = await db
    .select({
      id: logEntries.id,
      dato: logEntries.entryDate,
      fort: logEntries.createdAt,
      tittel: logEntries.title,
      tekst: logEntries.description,
      navn: logEntries.createdBy,
      naaNavn: forfatter.name,
      vendorNavn: vendors.name,
    })
    .from(logEntries)
    .leftJoin(forfatter, eq(forfatter.id, logEntries.createdByUserId))
    .leftJoin(vendors, eq(vendors.id, logEntries.vendorId))
    .where(eq(logEntries.orgId, orgId));

  const poster: Loggpost[] = [
    ...kvitteringer.map((r) => ({
      id: `oppgave-${r.id}`,
      kilde: "oppgave" as const,
      tittel: `${r.tittel} fullført`,
      tekst: enLinje(r.notat),
      tidspunkt: r.nar.toISOString(),
      visKlokke: true,
      vendorName: r.vendorDa ?? r.vendorNaa,
      aktor: `Kvittert av ${r.naaNavn ?? r.navn}`,
      sti: `/oppgaver/${r.taskId}`,
    })),
    ...avvikRader.map((r) => ({
      id: `avvik-meldt-${r.id}`,
      kilde: "avvik" as const,
      tittel: `Avvik ${r.nummer ? `#${String(r.nummer).padStart(3, "0")} ` : ""}meldt: ${r.tittel}`,
      tekst: null,
      tidspunkt: r.meldt.toISOString(),
      visKlokke: true,
      vendorName: r.vendorNavn,
      aktor: `Meldt av ${r.meldtAvNaa ?? r.meldtAv}`,
      sti: `/avvik/${r.id}`,
    })),
    // Lukkingen er en EGEN hendelse: meldt i januar og lukket i mars er to punkter på
    // tidslinja, og det er avstanden mellom dem som forteller hvordan styret jobber.
    ...avvikRader
      .filter((r) => r.lukket !== null)
      .map((r) => ({
        id: `avvik-lukket-${r.id}`,
        kilde: "avvik" as const,
        tittel: `Avvik ${r.nummer ? `#${String(r.nummer).padStart(3, "0")} ` : ""}lukket: ${r.tittel}`,
        tekst: enLinje(r.losning),
        tidspunkt: r.lukket!.toISOString(),
        visKlokke: true,
        vendorName: r.vendorNavn,
        aktor: r.lukketAv ? `Lukket av ${r.lukketAvNaa ?? r.lukketAv}` : null,
        sti: `/avvik/${r.id}`,
      })),
    ...servicer.map((r) => ({
      id: `service-${r.id}`,
      kilde: "vedlikehold" as const,
      tittel: r.tittel,
      tekst: enLinje(r.notat),
      tidspunkt: r.nar,
      visKlokke: false,
      vendorName: null,
      aktor: r.utfortAv ? `Utført av ${r.utfortAv}` : null,
      sti: `/vedlikehold/${r.elementId}`,
    })),
    ...enhetsarbeid.map((r) => ({
      id: `arbeid-${r.id}`,
      kilde: "vedlikehold" as const,
      tittel: `${r.tittel} — ${r.enhet}`,
      tekst: null,
      tidspunkt: r.nar,
      visKlokke: false,
      vendorName: r.vendorNavn,
      aktor: r.utfortAv
        ? `Utført av ${r.utfortAv}`
        : `Registrert av ${r.naaNavn ?? r.navn}`,
      sti: "/vedlikehold",
    })),
    ...runder.map((r) => ({
      id: `runde-${r.id}`,
      kilde: "vernerunde" as const,
      tittel: `Vernerunde gjennomført: ${r.tittel}`,
      tekst: null,
      tidspunkt: r.nar!,
      visKlokke: false,
      vendorName: null,
      aktor: null,
      sti: `/internkontroll/vernerunde/${r.id}`,
    })),
    ...notater.map((r) => {
      // Ført samme dag som datoen den gjelder → klokkeslettet er reelt. Etterregistrert
      // («i forrige uke byttet vi …») → bare datoen, et klokkeslett ville vært diktet.
      const sammeDag = r.fort.toISOString().slice(0, 10) === r.dato;
      return {
        id: `notat-${r.id}`,
        kilde: "manuelt" as const,
        tittel: r.tittel,
        tekst: enLinje(r.tekst),
        tidspunkt: sammeDag ? r.fort.toISOString() : r.dato,
        visKlokke: sammeDag,
        vendorName: r.vendorNavn,
        aktor: `Ført av ${r.naaNavn ?? r.navn}`,
        sti: null,
      };
    }),
  ].sort((a, b) => (a.tidspunkt < b.tidspunkt ? 1 : a.tidspunkt > b.tidspunkt ? -1 : 0));

  const antall = Object.fromEntries(LOGGKILDER.map((k) => [k, 0])) as Record<Loggkilde, number>;
  for (const p of poster) antall[p.kilde]++;

  return { poster, antall };
}
