/**
 * Plattformpanelet — DriftIQs egen side av systemet.
 *
 * ## Hvorfor dette laget bruker `withoutRls`
 *
 * Panelet ser på tvers av ALLE kunder, og har derfor per definisjon ingen org-kontekst.
 * `withOrg` er umulig: det finnes ikke én org å be om. `"plattformpanel"` er nettopp en av
 * de begrunnede unntaksverdiene i `db/client.ts`.
 *
 * Konsekvensen er at gaten må stå i ruta, ikke i databasen. Hver eneste rute her MÅ derfor
 * gå gjennom `plattformRute({ nivaa: "plattformadmin" })`.
 *
 * ## Panelet gir IKKE innsyn i kundedata
 *
 * Det viser kundeforholdet — navn, moduler, antall brukere, lagring. For å se selve dataene
 * (oppgaver, avvik, beboere) må plattformadmin starte en support-sesjon, og den håndheves i
 * `tilgang.ts`, ikke her. Skillet er poenget: å administrere en kunde og å lese kundens data
 * er to ulike ting, og bare den andre er inngripende.
 */

import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { supportAccessLog } from "../db/schema/platform";
import { deviations } from "../db/schema/avvik";
import { tasks } from "../db/schema/tasks";
import { userOrgMemberships, users } from "../db/schema/users";
import { ikkeFunnet, ugyldig } from "./api";
import { SUPPORT_SESJON_MAKS_TIMER, supportSesjonUtlop } from "./tilgang";

export const supportStart = z.object({
  orgId: z.string().min(1),
  /**
   * Begrunnelsen er PÅKREVD og fritekst.
   *
   * En innsynslogg uten grunn svarer bare på «når», og det er det minst interessante
   * spørsmålet. Nedtrekk med faste valg ble vurdert bort: den ekte grunnen er nesten alltid
   * «kunden ringte om X», og et nedtrekk ville presset den inn i «annet».
   */
  reason: z.string().trim().min(3, "Skriv en kort begrunnelse for innsynet"),
});

/** Kundeoversikten. Tallene er kundeforhold, ikke innhold. */
export async function hentKunder(db: Db) {
  const orger = await db
    .select({
      id: organizations.id,
      navn: organizations.name,
      orgNr: organizations.orgNr,
      orgForm: organizations.orgForm,
      kommune: organizations.municipality,
      antallEnheter: organizations.unitCount,
      aktiv: organizations.active,
      moduler: organizations.enabledModules,
      opprettet: organizations.createdAt,
    })
    .from(organizations)
    .orderBy(organizations.name);

  // Ett oppslag for alle kunder, ikke ett per kunde.
  const brukere = await db
    .select({ orgId: userOrgMemberships.orgId, n: count() })
    .from(userOrgMemberships)
    .groupBy(userOrgMemberships.orgId);
  const perOrg = new Map(brukere.map((r) => [r.orgId, r.n]));

  const apneSesjoner = await db
    .select({ orgId: supportAccessLog.orgId })
    .from(supportAccessLog)
    .where(and(isNull(supportAccessLog.endedAt), sql`${supportAccessLog.expiresAt} > now()`));
  const medSesjon = new Set(apneSesjoner.map((r) => r.orgId));

  return orger.map((o) => ({
    ...o,
    antallBrukere: perOrg.get(o.id) ?? 0,
    harAktivSupport: medSesjon.has(o.id),
  }));
}

/** Én kunde, med litt mer kontekst — fortsatt uten å vise selve innholdet. */
export async function hentKunde(db: Db, orgId: string) {
  const rader = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const org = rader[0];
  if (!org) throw ikkeFunnet("Organisasjon");

  const [brukere, oppgaver, avvik, sesjoner] = await Promise.all([
    db
      .select({
        id: users.id,
        navn: users.name,
        epost: users.email,
        nivaa: userOrgMemberships.role,
        sistInnlogget: users.lastLoginAt,
      })
      .from(userOrgMemberships)
      .innerJoin(users, eq(users.id, userOrgMemberships.userId))
      .where(eq(userOrgMemberships.orgId, orgId)),
    db.select({ n: count() }).from(tasks).where(eq(tasks.orgId, orgId)),
    db.select({ n: count() }).from(deviations).where(eq(deviations.orgId, orgId)),
    // Innsynsloggen. Vises HER, i panelet, og ikke bare i databasen — en logg ingen ser på
    // er ikke en kontroll, den er en formalitet.
    db
      .select()
      .from(supportAccessLog)
      .where(eq(supportAccessLog.orgId, orgId))
      .orderBy(desc(supportAccessLog.startedAt))
      .limit(20),
  ]);

  return {
    ...org,
    brukere,
    antallOppgaver: oppgaver[0]?.n ?? 0,
    antallAvvik: avvik[0]?.n ?? 0,
    sesjoner,
    maksTimer: SUPPORT_SESJON_MAKS_TIMER,
  };
}

/**
 * Starter en support-sesjon.
 *
 * Navnet KOPIERES inn i loggen. Slettes plattformbrukeren senere, skal loggen fortsatt vise
 * hvem som var inne — historikk peker aldri på noe som kan endres i ettertid.
 *
 * En allerede aktiv sesjon gjenbrukes ikke: hver start er en ny rad med sin egen grunn. To
 * ulike ærend samme dag er to innsyn, ikke ett.
 */
export async function startSupport(
  db: Db,
  admin: { id: string; name: string },
  data: z.infer<typeof supportStart>,
) {
  const finnes = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, data.orgId))
    .limit(1);
  if (!finnes[0]) throw ikkeFunnet("Organisasjon");

  const [rad] = await db
    .insert(supportAccessLog)
    .values({
      id: randomUUID(),
      superadminId: admin.id,
      adminName: admin.name,
      orgId: data.orgId,
      reason: data.reason,
      expiresAt: supportSesjonUtlop(),
    })
    .returning();
  return rad!;
}

/**
 * Avslutter egne aktive sesjoner i en org.
 *
 * Bare EGNE: en plattformadmin skal ikke kunne lukke en kollegas pågående innsyn og dermed
 * gjøre loggen misvisende om hvor lenge det varte.
 */
export async function avsluttSupport(db: Db, adminId: string, orgId: string) {
  const oppdatert = await db
    .update(supportAccessLog)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(supportAccessLog.superadminId, adminId),
        eq(supportAccessLog.orgId, orgId),
        isNull(supportAccessLog.endedAt),
      ),
    )
    .returning();
  if (oppdatert.length === 0) throw ugyldig("Du har ingen aktiv support-sesjon i denne organisasjonen.");
  return { avsluttet: oppdatert.length };
}
