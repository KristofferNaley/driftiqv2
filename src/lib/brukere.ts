/**
 * Brukere og tilgangsstyring. Port av v1s `routers/users.py`.
 *
 * ## Tilgangen ligger på MEDLEMSKAPET, ikke på brukeren
 *
 * Én bruker kan være orgadmin i ett borettslag og ha visningstilgang i et annet. Derfor
 * endres nivået på `userOrgMemberships`, og «slett bruker» fra en org fjerner medlemskapet
 * — ikke kontoen. Brukeren kan fortsatt logge inn og se sine andre lag.
 */

import { and, asc, count, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { account } from "../db/schema/auth";
import { userOrgMemberships, users } from "../db/schema/users";
import { ikkeFunnet, ugyldig } from "./api";
// Etikettene bor i en ren fil uten server-importer — se kommentaren der.
import { NIVAER } from "./nivaer";

export { NIVAER, NIVA_ETIKETT, TILGANGSNIVAER } from "./nivaer";

export const inviterInn = z.object({
  name: z.string().trim().min(1, "Navn må fylles ut"),
  email: z.string().trim().toLowerCase().email("Ugyldig e-postadresse"),
  role: z.enum(NIVAER).default("visning"),
  title: z.string().trim().nullish(),
});

export const medlemEndring = z.object({
  role: z.enum(NIVAER).optional(),
  title: z.string().trim().nullish(),
  /**
   * Navnet ligger på KONTOEN, ikke medlemskapet — retter du en skrivefeil her, endres det
   * i alle lag personen sitter i. Det er riktig: et navn er det samme overalt. E-posten kan
   * derimot ikke endres, fordi den er innloggingsnøkkelen.
   */
  name: z.string().trim().min(1, "Navn må fylles ut").optional(),
});

export async function hentBrukere(db: Db, orgId: string) {
  const rader = await db
    .select({ bruker: users, medlemskap: userOrgMemberships })
    .from(userOrgMemberships)
    .innerJoin(users, eq(users.id, userOrgMemberships.userId))
    .where(eq(userOrgMemberships.orgId, orgId))
    .orderBy(asc(users.name));

  // Har brukeren satt passord? Er det ikke gjort, står invitasjonen fortsatt ute — og det
  // er noe styret trenger å se, ellers venter de på en som aldri har kommet inn.
  const medPassord = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.providerId, "credential"));
  const harPassord = new Set(medPassord.map((r) => r.userId));

  return rader.map((r) => ({
    id: r.bruker.id,
    name: r.bruker.name,
    email: r.bruker.email,
    active: r.bruker.active,
    lastLoginAt: r.bruker.lastLoginAt,
    /** Plattformrollen — `superadmin` er DriftIQ-ansatt, ikke kundens administrator. */
    platformRole: r.bruker.role,
    nivaa: r.medlemskap.role,
    title: r.medlemskap.title,
    harSattPassord: harPassord.has(r.bruker.id),
  }));
}

/** Antall orgadmins. Brukes til å hindre at den siste fjernes. */
async function antallAdmins(db: Db, orgId: string, utenom?: string): Promise<number> {
  const betingelser = [eq(userOrgMemberships.orgId, orgId), eq(userOrgMemberships.role, "orgadmin")];
  if (utenom) betingelser.push(ne(userOrgMemberships.userId, utenom));
  const rader = await db
    .select({ n: count() })
    .from(userOrgMemberships)
    .where(and(...betingelser));
  return rader[0]?.n ?? 0;
}

/**
 * Ber Better Auth mynte en engangslenke og sende den.
 *
 * Malen velges av `sendResetPassword` i auth.ts ut fra om kontoen har et passord fra før —
 * en ny bruker får velkomst, en eksisterende får tilbakestilling.
 *
 * Feil svelges: e-post er en SIDEVIRKNING av invitasjonen, ikke selve invitasjonen. Blir
 * brukeren opprettet uten at e-posten går ut, kan admin sende den på nytt — men rulles
 * opprettelsen tilbake fordi Resend var nede, har vi mistet arbeidet i stedet.
 */
export async function sendOppsettEpost(epost: string): Promise<void> {
  try {
    const { auth } = await import("./auth");
    await auth.api.requestPasswordReset({ body: { email: epost } });
  } catch (e) {
    console.error(`[brukere] Kunne ikke sende oppsett-e-post til ${epost}:`, e);
  }
}

/**
 * Inviterer en bruker.
 *
 * Finnes e-posten fra før, får den eksisterende kontoen bare et nytt medlemskap — en person
 * som sitter i to styrer skal ha ÉN konto, ikke to.
 *
 * Nye brukere opprettes UTEN passord og får en engangslenke på e-post der de setter det
 * selv. Ingen andre enn dem kjenner det da — heller ikke den som inviterte, og heller ikke
 * DriftIQ. Samme modell som v1.
 */
export async function inviterBruker(db: Db, orgId: string, data: z.infer<typeof inviterInn>) {
  const finnes = await db
    .select()
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);

  let brukerId: string;
  if (finnes[0]) {
    brukerId = finnes[0].id;
    const alt = await db
      .select({ id: userOrgMemberships.id })
      .from(userOrgMemberships)
      .where(and(eq(userOrgMemberships.userId, brukerId), eq(userOrgMemberships.orgId, orgId)))
      .limit(1);
    if (alt.length > 0) throw ugyldig("Brukeren har allerede tilgang til denne organisasjonen");
  } else {
    brukerId = randomUUID();
    await db.insert(users).values({
      id: brukerId,
      name: data.name,
      email: data.email,
      role: "member",
      active: true,
      // Ingen `account`-rad: brukeren har ikke passord ennå og må sette det selv.
      emailVerified: false,
    });
  }

  await db.insert(userOrgMemberships).values({
    id: randomUUID(),
    userId: brukerId,
    orgId,
    role: data.role,
    title: data.title ?? null,
  });

  // E-posten sendes IKKE herfra. Vi står inne i en transaksjon, og Better Auth slår opp
  // adressen på en annen tilkobling — raden finnes ikke for den ennå. Kallstedet sender via
  // `etterCommit`. Se kommentaren i api.ts.
  return { id: brukerId, nyKonto: !finnes[0] };
}

export async function endreMedlemskap(
  db: Db,
  orgId: string,
  brukerId: string,
  data: z.infer<typeof medlemEndring>,
) {
  const rader = await db
    .select()
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.userId, brukerId), eq(userOrgMemberships.orgId, orgId)))
    .limit(1);
  const medlemskap = rader[0];
  if (!medlemskap) throw ikkeFunnet("Bruker i denne organisasjonen");

  // Den siste administratoren kan ikke degraderes. Uten sperren kan et styre låse seg selv
  // ute av kontosidene, og da må DriftIQ inn med support-modus for å rette det opp.
  if (data.role && data.role !== "orgadmin" && medlemskap.role === "orgadmin") {
    if ((await antallAdmins(db, orgId, brukerId)) === 0) {
      throw ugyldig("Organisasjonen må ha minst én administrator.");
    }
  }

  if (data.name) {
    await db.update(users).set({ name: data.name }).where(eq(users.id, brukerId));
  }

  // Bare feltene som faktisk hører til medlemskapet. Drizzle kaster på `.set({})`, så et
  // kall som utelukkende retter navnet må hoppe over skrivingen her.
  const medlemsfelter: Partial<typeof medlemskap> = {};
  if (data.role !== undefined) medlemsfelter.role = data.role;
  if (data.title !== undefined) medlemsfelter.title = data.title ?? null;
  if (Object.keys(medlemsfelter).length === 0) return medlemskap;

  const [endret] = await db
    .update(userOrgMemberships)
    .set(medlemsfelter)
    .where(and(eq(userOrgMemberships.userId, brukerId), eq(userOrgMemberships.orgId, orgId)))
    .returning();
  return endret!;
}

/**
 * Fjerner brukerens tilgang til DENNE org-en. Kontoen består — brukeren kan sitte i flere
 * styrer, og en oppsigelse i ett lag skal ikke stenge dem ute av et annet.
 */
export async function fjernFraOrg(db: Db, orgId: string, brukerId: string) {
  const rader = await db
    .select()
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.userId, brukerId), eq(userOrgMemberships.orgId, orgId)))
    .limit(1);
  const medlemskap = rader[0];
  if (!medlemskap) throw ikkeFunnet("Bruker i denne organisasjonen");

  if (medlemskap.role === "orgadmin" && (await antallAdmins(db, orgId, brukerId)) === 0) {
    throw ugyldig("Organisasjonen må ha minst én administrator.");
  }

  await db
    .delete(userOrgMemberships)
    .where(and(eq(userOrgMemberships.userId, brukerId), eq(userOrgMemberships.orgId, orgId)));
}
