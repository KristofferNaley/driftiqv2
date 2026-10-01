/**
 * Hvem som er KUNDENS bruker — styret — og ikke noen som bare har en inngang hos kunden.
 *
 * Plattformadmin og kontoansvarlig har medlemskap for å yte support, og agentkontoer
 * (`users.is_agent`, f.eks. `agent@driftiq.no`) er der for testing. Ingen av dem sier noe om
 * hvorvidt kunden bruker systemet: de teller ikke i onboarding, «sist aktiv», innlogginger
 * eller kundehelse. Én regel her, ikke sju kopier — før BL-182 sto rolle-unntaket skrevet ut
 * på hvert sted.
 */

import { and, eq, ne } from "drizzle-orm";
import { users } from "../db/schema/users";

/** Plattformrollene. Verdien heter fortsatt `superadmin` i basen (se `lib/nivaer.ts`). */
const PLATTFORMROLLER = ["superadmin", "kontoansvarlig"] as const;

/** Drizzle-betingelsen på `users`: kundens egne brukere. */
export const erKundebruker = and(
  ne(users.role, "superadmin"),
  ne(users.role, "kontoansvarlig"),
  eq(users.isAgent, false),
);

/** Samme regel på en rad som allerede er hentet. */
export function erKundensBruker(b: { rolle: string; agent: boolean }): boolean {
  return !(PLATTFORMROLLER as readonly string[]).includes(b.rolle) && !b.agent;
}

/** Plattformbruker (support-inngang), til merket i brukerlista. */
export function erPlattformbruker(rolle: string): boolean {
  return (PLATTFORMROLLER as readonly string[]).includes(rolle);
}
