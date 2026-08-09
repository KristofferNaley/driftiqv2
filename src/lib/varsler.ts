/**
 * Lesing og skriving av varselinnstillinger. Port av v1s `varsler.py`.
 *
 * Kolonnen er fri tekst med JSON i, ikke `jsonb` — v1 valgte `Text`, og migreringen kopierer
 * verdien ordrett. Å bytte type her ville gjort migreringsskriptet til en konvertering.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { userOrgMemberships } from "../db/schema/users";
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
