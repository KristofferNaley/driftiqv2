/**
 * «Slett kunde» — fjerner en organisasjon og ALT den eier, for godt.
 *
 * Tenkt for kunder som har prøvd systemet uten å gå videre, og for sletting etter
 * oppsigelse («innsyn i og sletting av dataene deres», se `ABONNEMENT_UTLOPT_MELDING`).
 * Det finnes ingen angre: raden, barnetabellene og filene på disk er borte etterpå.
 *
 * ## To sperrer før noe slettes
 *
 * 1. Kunden må være satt **inaktiv** først. Da har kunden allerede vært stengt ute (og
 *    orgen borte fra orgvelgeren), så slettingen er andre steg av to — ikke ett feiltrykk.
 * 2. Navnet må tastes inn og stemme med raden, sjekket på serveren.
 *
 * I tillegg nektes sletting så lenge kunden har digitale nøkler hos Unloc som ikke er
 * trukket tilbake: radene våre forsvinner, men nøklene ville fortsatt åpnet dørene.
 *
 * ## Rekkefølgen
 *
 * De fleste tabellene har `ON DELETE CASCADE` mot `organizations` og forsvinner med raden.
 * Tabellene i `SLETTES_EKSPLISITT` har det ikke (arv fra v1-skjemaet), og noen av dem peker
 * på hverandre uten kaskade — derfor slettes de her i FK-riktig rekkefølge før orgen.
 * `tests/kundesletting.test.ts` leser fremmednøklene fra databasen og feiler hvis en ny
 * tabell peker på `organizations` uten kaskade og uten å stå i lista.
 */

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { supportAccessLog } from "../db/schema/platform";
import { completions, tasks } from "../db/schema/tasks";
import { deviations } from "../db/schema/avvik";
import { routines } from "../db/schema/rutiner";
import { contracts } from "../db/schema/kontrakter";
import { buildingElements, unitWorks } from "../db/schema/vedlikehold";
import { logEntries } from "../db/schema/driftslogg";
import { units } from "../db/schema/units";
import { vendors } from "../db/schema/vendors";
import { vendorUnlocKeys } from "../db/schema/unloc";
import { userOrgMemberships, users } from "../db/schema/users";
import { leadActivities, leads } from "../db/schema/leads";
import { ApiFeil, ikkeFunnet, ugyldig } from "./api";
import type { Aktor } from "./aktor";
import { orgSti } from "./lagring";
import { PLATTFORMADMIN } from "./nivaer";

export const kundeSletting = z.object({
  /** Kundens navn, tastet inn av den som sletter. Må stemme nøyaktig. */
  bekreftNavn: z.string().trim().min(1, "Skriv inn kundens navn for å bekrefte"),
});

/**
 * Tabellene med en fremmednøkkel mot `organizations` UTEN `ON DELETE CASCADE`, og hvordan
 * de håndteres. Registeret testen sammenligner med databasen.
 */
export const SLETTES_EKSPLISITT: Readonly<Record<string, string>> = {
  deviations: "slettes først — peker på oppgaver, enheter, leverandører og vernerunder",
  deviation_attachments: "følger avviket (kaskade fra deviations)",
  tasks: "slettes etter avvik, rutiner og utførelser som peker på dem",
  completion_photos: "følger utførelsen (kaskade fra completions)",
  contracts: "slettes etter rutinene som peker på dem",
  units: "slettes etter oppgaver, avvik og enhetsarbeid",
  vendors: "slettes sist av driftsdataene — nesten alt peker på leverandør",
  vendor_access_items: "følger leverandøren (kaskade fra vendors)",
  vendor_contacts: "følger leverandøren (kaskade fra vendors)",
  vendor_notes: "følger leverandøren (kaskade fra vendors)",
  support_access_log: "innsynsloggen slettes med kunden",
  users: "arvekolonnen users.org_id nulles; kontoene vurderes for seg",
};

/** Unloc-tilstander der nøkkelen ikke lenger åpner noe. */
const DODE_NOKKELTILSTANDER = ["expired", "revoked"];

export type Slettesvar = {
  navn: string;
  slettedeBrukere: number;
  /** Brukere som også er med i andre kunder, eller er plattformadmin — de beholdes. */
  beholdteBrukere: number;
};

/**
 * Sletter kunden i den transaksjonen `db` står i. Filene på disk ryddes av kallstedet
 * ETTER commit med `slettKundefiler` — ruller transaksjonen tilbake, skal filene stå.
 */
export async function slettKunde(
  db: Db,
  orgId: string,
  data: z.infer<typeof kundeSletting>,
  aktor: Aktor,
): Promise<Slettesvar> {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, active: organizations.active })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) throw ikkeFunnet("Organisasjon");

  if (org.active) {
    throw ugyldig("Sett kunden som inaktiv før den slettes (Organisasjon → Rediger → Aktiv kunde).");
  }
  if (data.bekreftNavn !== org.name.trim()) {
    throw ugyldig("Navnet stemmer ikke med kunden. Ingenting er slettet.");
  }

  const levendeNokler = await db
    .select({ id: vendorUnlocKeys.id })
    .from(vendorUnlocKeys)
    .where(
      and(
        eq(vendorUnlocKeys.orgId, orgId),
        isNull(vendorUnlocKeys.revokedAt),
        notInArray(vendorUnlocKeys.state, DODE_NOKKELTILSTANDER),
      ),
    );
  if (levendeNokler.length > 0) {
    throw new ApiFeil(
      409,
      `Kunden har ${levendeNokler.length} digitale nøkler hos Unloc som ikke er trukket tilbake. ` +
        "Trekk dem tilbake i kundeappen først — slettingen her fjerner dem ikke hos Unloc.",
    );
  }

  // Kontoene som bare finnes for denne kunden. Regnes ut FØR medlemskapene forsvinner.
  const medlemmer = await db
    .select({ id: users.id, role: users.role })
    .from(userOrgMemberships)
    .innerJoin(users, eq(users.id, userOrgMemberships.userId))
    .where(eq(userOrgMemberships.orgId, orgId));
  const andreMedlemskap = medlemmer.length
    ? await db
        .select({ userId: userOrgMemberships.userId })
        .from(userOrgMemberships)
        .where(
          and(
            inArray(userOrgMemberships.userId, medlemmer.map((m) => m.id)),
            ne(userOrgMemberships.orgId, orgId),
          ),
        )
    : [];
  const iAndreKunder = new Set(andreMedlemskap.map((r) => r.userId));
  const slettbare = medlemmer
    .filter((m) => m.role !== PLATTFORMADMIN && !iAndreKunder.has(m.id))
    .map((m) => m.id);

  // ── Tabellene uten kaskade, i FK-riktig rekkefølge ───────────────────────────────────
  const orgOppgaver = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.orgId, orgId));

  await db.delete(deviations).where(eq(deviations.orgId, orgId));
  await db.delete(routines).where(eq(routines.orgId, orgId));
  await db.delete(completions).where(inArray(completions.taskId, orgOppgaver));
  await db.delete(tasks).where(eq(tasks.orgId, orgId));
  await db.delete(contracts).where(eq(contracts.orgId, orgId));
  // Kaskaderer fra orgen, men peker på enheter/leverandører uten kaskade — må ut før dem.
  await db.delete(unitWorks).where(eq(unitWorks.orgId, orgId));
  await db.delete(buildingElements).where(eq(buildingElements.orgId, orgId));
  await db.delete(logEntries).where(eq(logEntries.orgId, orgId));
  await db.delete(units).where(eq(units.orgId, orgId));
  await db.delete(vendors).where(eq(vendors.orgId, orgId));
  await db.delete(supportAccessLog).where(eq(supportAccessLog.orgId, orgId));
  await db.update(users).set({ orgId: null }).where(eq(users.orgId, orgId));

  // Leaden kunden kom fra mister koblingen (SET NULL) og beholder statusen «konvertert» —
  // se `leads.convertedOrgId`. En linje i loggen sier hvorfor lenken er borte.
  const fraLead = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.convertedOrgId, orgId));
  for (const l of fraLead) {
    await db.insert(leadActivities).values({
      id: randomUUID(),
      leadId: l.id,
      text: "Kunden slettet",
      note: org.name,
      actorName: aktor.navn,
      actorUserId: aktor.brukerId,
    });
  }

  // Resten (medlemskap, avtaler, dokumenter, oppslagstavle, integrasjoner, hendelseslogg, …)
  // går med kaskaden.
  await db.delete(organizations).where(eq(organizations.id, orgId));

  if (slettbare.length > 0) {
    await db.delete(users).where(inArray(users.id, slettbare));
  }

  console.info(
    `[kundesletting] ${aktor.navn} slettet kunden «${org.name}» (${orgId}); ` +
      `${slettbare.length} brukerkontoer slettet.`,
  );

  return {
    navn: org.name,
    slettedeBrukere: slettbare.length,
    beholdteBrukere: medlemmer.length - slettbare.length,
  };
}

/** Fjerner `uploads/orgs/{orgId}/` — alt kunden har lastet opp ligger under den ene mappa. */
export async function slettKundefiler(orgId: string): Promise<void> {
  // `orgSti` nekter `/`, `\\` og `..`. `turbopackIgnore`: se kommentaren i `lagreFil`.
  await rm(/* turbopackIgnore: true */ orgSti(orgId), { recursive: true, force: true });
}
