/**
 * Lesing og skriving av varselinnstillinger. Port av v1s `varsler.py`.
 *
 * Kolonnen er fri tekst med JSON i, ikke `jsonb` — v1 valgte `Text`, og migreringen kopierer
 * verdien ordrett. Å bytte type her ville gjort migreringsskriptet til en konvertering.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { userOrgMemberships, users } from "../db/schema/users";
import { ikkeFunnet } from "./api";
import { VARSEL_NOKLER, VARSEL_STANDARD, type VarselNokkel } from "./varselvalg";

export { VARSLER, VARSEL_STANDARD } from "./varselvalg";

export const varselOppdatering = z.object({
  prefs: z.record(z.string(), z.boolean()),
});

/**
 * Innstillingene for ett medlemskap, med standardverdier for nøkler som mangler.
 *
 * Ukjente nøkler fra basen slippes bevisst gjennom: da overlever en verdi at en nøkkel
 * midlertidig tas ut av koden, i stedet for å bli slettet ved neste lagring.
 */
export function lesPrefs(lagret: string | null): Record<string, boolean> {
  let fraBase: Record<string, boolean> = {};
  if (lagret) {
    try {
      fraBase = (JSON.parse(lagret) as Record<string, boolean>) ?? {};
    } catch {
      // Ødelagt JSON skal ikke velte siden — brukeren får standardoppsettet.
      fraBase = {};
    }
  }
  return { ...VARSEL_STANDARD, ...fraBase };
}

async function hentMedlemskap(db: Db, orgId: string, brukerId: string) {
  const rader = await db
    .select()
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.orgId, orgId), eq(userOrgMemberships.userId, brukerId)))
    .limit(1);
  const m = rader[0];
  if (!m) throw ikkeFunnet("Bruker i denne organisasjonen");
  return m;
}

/**
 * Hvem i org-en som vil ha ETT bestemt varsel.
 *
 * Går til hver enkelt som har bedt om det, ikke til én felles adresse per organisasjon slik
 * v1 gjorde før 2026. Deaktiverte brukere og brukere uten e-post faller ut.
 */
export async function mottakere(
  db: Db,
  orgId: string,
  nokkel: VarselNokkel,
): Promise<Array<{ id: string; navn: string; epost: string }>> {
  const rader = await db
    .select({
      id: users.id,
      navn: users.name,
      epost: users.email,
      prefs: userOrgMemberships.notificationPrefs,
    })
    .from(userOrgMemberships)
    .innerJoin(users, eq(users.id, userOrgMemberships.userId))
    .where(and(eq(userOrgMemberships.orgId, orgId), eq(users.active, true)));

  return rader
    .filter((r) => Boolean(r.epost) && lesPrefs(r.prefs)[nokkel] === true)
    .map((r) => ({ id: r.id, navn: r.navn, epost: r.epost }));
}

/** Om ÉN bruker vil ha ett bestemt varsel i én organisasjon. */
export async function varselPa(
  db: Db,
  brukerId: string,
  orgId: string,
  nokkel: VarselNokkel,
): Promise<boolean> {
  const rader = await db
    .select({ prefs: userOrgMemberships.notificationPrefs })
    .from(userOrgMemberships)
    .where(and(eq(userOrgMemberships.orgId, orgId), eq(userOrgMemberships.userId, brukerId)))
    .limit(1);
  if (!rader[0]) return false;
  return lesPrefs(rader[0].prefs)[nokkel] === true;
}

export async function hentVarsler(db: Db, orgId: string, brukerId: string) {
  const m = await hentMedlemskap(db, orgId, brukerId);
  return { prefs: lesPrefs(m.notificationPrefs) };
}

/**
 * Lagrer KUN kjente nøkler, som bool. Skjemaet er fritt JSON på vei inn, så uten
 * filtreringen kunne hva som helst havnet i kolonnen.
 */
export async function settVarsler(
  db: Db,
  orgId: string,
  brukerId: string,
  inn: Record<string, boolean>,
) {
  const m = await hentMedlemskap(db, orgId, brukerId);
  const rene: Record<string, boolean> = {};
  for (const n of VARSEL_NOKLER) {
    if (n in inn) rene[n] = Boolean(inn[n as VarselNokkel]);
  }
  const nye = { ...lesPrefs(m.notificationPrefs), ...rene };
  await db
    .update(userOrgMemberships)
    .set({ notificationPrefs: JSON.stringify(nye) })
    .where(and(eq(userOrgMemberships.orgId, orgId), eq(userOrgMemberships.userId, brukerId)));
  return { prefs: nye };
}
