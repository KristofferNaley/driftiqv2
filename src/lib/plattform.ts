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

import { and, count, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { platformContracts, supportAccessLog } from "../db/schema/platform";
import { aiUsageDaily } from "../db/schema/ai";
import { deviations } from "../db/schema/avvik";
import { completions, tasks } from "../db/schema/tasks";
import { userOrgMemberships, users } from "../db/schema/users";
import { ikkeFunnet, ugyldig } from "./api";
import { SUPPORT_SESJON_MAKS_TIMER, supportSesjonUtlop } from "./tilgang";
import { PLATTFORMADMIN } from "./nivaer";

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

/**
 * Forsiden i panelet.
 *
 * Tallene er PLATTFORMENS, ikke én kundes: hvor mange kunder finnes, hvor mye brukes
 * systemet, hva koster AI-en. Ingen av dem røper innholdet i en bestemt kundes data — det
 * krever fortsatt support-modus.
 */
export async function hentDashbord(db: Db) {
  const [kunder, oppgaver, avvik, kvitteringer, salg, ai, sesjoner] = await Promise.all([
    db
      .select({ aktiv: organizations.active, n: count() })
      .from(organizations)
      .groupBy(organizations.active),
    db.select({ n: count() }).from(tasks).where(eq(tasks.active, true)),
    db.select({ n: count() }).from(deviations).where(sql`${deviations.status} <> 'lukket'`),
    db.select({ n: count() }).from(completions),
    // `sum()` på integer gir BIGINT, og node-postgres returnerer bigint som STRENG for å
    // ikke miste presisjon. Typen under lyver derfor, og verdien må gjennom `Number()` —
    // ellers blir `a + b` strengkonkatenering. Det skjedde: 80 620 + 5 013 ble «806205013».
    db.select({ sum: sql<string | null>`sum(${platformContracts.annualFee})` }).from(platformContracts),
    // Siste 30 dager. Tokens, ikke kroner: prisen per token endres, og et lagret kronebeløp
    // ville vært feil dagen etter.
    db
      .select({
        sporsmal: sql<string | null>`sum(${aiUsageDaily.questions})`,
        inn: sql<string | null>`sum(${aiUsageDaily.inputTokens})`,
        ut: sql<string | null>`sum(${aiUsageDaily.outputTokens})`,
      })
      .from(aiUsageDaily)
      .where(sql`${aiUsageDaily.date} >= current_date - interval '30 days'`),
    db
      .select({ n: count() })
      .from(supportAccessLog)
      .where(and(isNull(supportAccessLog.endedAt), sql`${supportAccessLog.expiresAt} > now()`)),
  ]);

  return {
    aktiveKunder: kunder.find((r) => r.aktiv)?.n ?? 0,
    inaktiveKunder: kunder.find((r) => !r.aktiv)?.n ?? 0,
    aktiveOppgaver: oppgaver[0]?.n ?? 0,
    apneAvvik: avvik[0]?.n ?? 0,
    kvitteringer: kvitteringer[0]?.n ?? 0,
    arligSalg: Number(salg[0]?.sum ?? 0),
    aiSporsmal: Number(ai[0]?.sporsmal ?? 0),
    aiTokens: Number(ai[0]?.inn ?? 0) + Number(ai[0]?.ut ?? 0),
    aktiveSesjoner: sesjoner[0]?.n ?? 0,
  };
}

/**
 * Alle support-sesjoner på tvers av kunder, nyeste først.
 *
 * Egen side fordi spørsmålet «hvem har innsyn akkurat nå?» ikke skal kreve at man åpner
 * hver kunde for seg. Det er nettopp det spørsmålet loggen finnes for å svare på.
 */
export async function hentSesjoner(db: Db, kunGjeldende = false) {
  const betingelser = kunGjeldende
    ? [isNull(supportAccessLog.endedAt), sql`${supportAccessLog.expiresAt} > now()`]
    : [];

  return db
    .select({
      id: supportAccessLog.id,
      adminNavn: supportAccessLog.adminName,
      orgId: supportAccessLog.orgId,
      orgNavn: organizations.name,
      grunn: supportAccessLog.reason,
      startet: supportAccessLog.startedAt,
      utloper: supportAccessLog.expiresAt,
      avsluttet: supportAccessLog.endedAt,
    })
    .from(supportAccessLog)
    .innerJoin(organizations, eq(organizations.id, supportAccessLog.orgId))
    .where(betingelser.length > 0 ? and(...betingelser) : undefined)
    .orderBy(desc(supportAccessLog.startedAt))
    .limit(100);
}

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


/* ── Plattformbrukere ──────────────────────────────────────────────────────────────────
 *
 * DriftIQs egne ansatte, ikke kundenes brukere. Skillet er hele grunnen til at rollen ligger
 * på `users.role` (plattformaksen) og ikke på et medlemskap: en plattformadmin er ansatt hos
 * OSS, uavhengig av hvilke kunder som finnes.
 *
 * ## `kontoansvarlig` er IKKE portert
 *
 * v1 har en tredje plattformrolle med tilgang begrenset til utvalgte kunder. Den er ikke
 * implementert i v2s tilgangslag — `erPlattformadmin` sjekker kun `superadmin`. Å tilby
 * rollen her ville gitt en bruker som ser ut til å ha tilgang og ikke har det, og det er
 * verre enn å ikke tilby den.
 */

export const plattformbrukerInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  email: z.string().trim().toLowerCase().email("Ugyldig e-postadresse"),
});

export const plattformbrukerEndring = z.object({
  name: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
  /** Fjerner plattformtilgangen. `member` er en helt vanlig bruker uten noe særlig. */
  role: z.enum([PLATTFORMADMIN, "member"]).optional(),
});

export async function hentPlattformbrukere(db: Db) {
  const rader = await db
    .select({
      id: users.id,
      navn: users.name,
      epost: users.email,
      rolle: users.role,
      aktiv: users.active,
      sistInnlogget: users.lastLoginAt,
      opprettet: users.createdAt,
    })
    .from(users)
    .where(eq(users.role, PLATTFORMADMIN))
    .orderBy(users.name);

  // Medlemskap i kundeorganisasjoner. En plattformadmin med medlemskap er verdt å se: gaten
  // IGNORERER dem (support-sesjon kreves uansett), så de gir en falsk trygghet om at
  // personen «har tilgang til» laget sitt.
  const medlemskap = await db
    .select({ brukerId: userOrgMemberships.userId, orgNavn: organizations.name })
    .from(userOrgMemberships)
    .innerJoin(organizations, eq(organizations.id, userOrgMemberships.orgId));

  return rader.map((r) => ({
    ...r,
    kundemedlemskap: medlemskap.filter((m) => m.brukerId === r.id).map((m) => m.orgNavn),
  }));
}

/** Antall aktive plattformadmins. Brukes til å hindre at den siste fjernes. */
async function antallAdmins(db: Db, utenom?: string): Promise<number> {
  const betingelser = [eq(users.role, PLATTFORMADMIN), eq(users.active, true)];
  if (utenom) betingelser.push(ne(users.id, utenom));
  const rader = await db.select({ n: count() }).from(users).where(and(...betingelser));
  return rader[0]?.n ?? 0;
}

/**
 * Oppretter en plattformadmin.
 *
 * Ingen passord settes her. Brukeren får en engangslenke på e-post og velger det selv — da
 * kjenner ingen andre det, heller ikke den som opprettet kontoen.
 *
 * Finnes e-posten fra før, HEVES den eksisterende kontoen i stedet for at det lages en ny.
 * To kontoer på samme adresse ville brutt innloggingen uansett (e-post er unik).
 */
export async function opprettPlattformbruker(db: Db, data: z.infer<typeof plattformbrukerInn>) {
  const finnes = await db.select().from(users).where(eq(users.email, data.email)).limit(1);

  if (finnes[0]) {
    await db.update(users).set({ role: PLATTFORMADMIN, active: true }).where(eq(users.id, finnes[0].id));
    return { id: finnes[0].id, nyKonto: false, epost: data.email };
  }

  const id = randomUUID();
  await db.insert(users).values({
    id,
    name: data.name,
    email: data.email,
    role: PLATTFORMADMIN,
    active: true,
    emailVerified: false,
  });
  return { id, nyKonto: true, epost: data.email };
}

/**
 * Endrer en plattformbruker.
 *
 * To sperrer, begge mot samme feil: at plattformen står uten noen som kan komme inn.
 *
 * 1. **Du kan ikke endre din egen rolle eller aktivstatus.** Det hindrer utilsiktet
 *    utestenging, og gjør loggen entydig — en rolleendring er alltid noe én person gjorde
 *    med en ANNEN.
 * 2. **Den siste aktive plattformadminen kan ikke fjernes.** Uten den finnes det ingen vei
 *    inn i panelet igjen, og ingen kan starte en support-sesjon for å rette opp.
 */
export async function endrePlattformbruker(
  db: Db,
  utfortAv: string,
  brukerId: string,
  data: z.infer<typeof plattformbrukerEndring>,
) {
  const rader = await db.select().from(users).where(eq(users.id, brukerId)).limit(1);
  const bruker = rader[0];
  if (!bruker) throw ikkeFunnet("Bruker");

  const endrerTilgang = data.role !== undefined || data.active !== undefined;
  if (endrerTilgang && brukerId === utfortAv) {
    throw ugyldig("Du kan ikke endre din egen rolle eller aktivstatus.");
  }

  const mister =
    (data.role !== undefined && data.role !== PLATTFORMADMIN) || data.active === false;
  if (mister && bruker.role === PLATTFORMADMIN && bruker.active) {
    if ((await antallAdmins(db, brukerId)) === 0) {
      throw ugyldig("Plattformen må ha minst én aktiv plattformadmin.");
    }
  }

  const felter: { name?: string; active?: boolean; role?: typeof PLATTFORMADMIN | "member" } = {};
  if (data.name !== undefined) felter.name = data.name;
  if (data.active !== undefined) felter.active = data.active;
  if (data.role !== undefined) felter.role = data.role;
  if (Object.keys(felter).length === 0) return bruker;

  const [endret] = await db.update(users).set(felter).where(eq(users.id, brukerId)).returning();
  return endret!;
}
