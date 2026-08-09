/**
 * Boligbyggelag — globalt register (BL-85).
 *
 * Står i `UNNTATT` i rls/tables.ts, og det er ikke en forglemmelse: registeret eies ikke av
 * noen kunde. Flere borettslag kan være tilknyttet samme lag, og lagene føres uavhengig av
 * om noen kunde bruker dem. En org-policy her ville betydd at laget forsvant så snart man
 * så på det uten org-kontekst — altså alltid, siden bare plattformpanelet skriver hit.
 */

import { boolean, date, pgTable, timestamp, varchar, text, type AnyPgColumn } from "drizzle-orm/pg-core";

export const bbl = pgTable("bbl", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  /** Lagres uten mellomrom — se `normaliserOrgnr` i lib/bbl.ts. */
  orgNr: varchar("org_nr").unique(),
  region: varchar("region"),
  website: varchar("website"),
  notes: text("notes"),
  /**
   * Fusjon: laget dette går inn i. Selvreferanse, så typen må annoteres eksplisitt —
   * TypeScript kan ellers ikke utlede den.
   *
   * Den gamle raden BLIR STÅENDE etter en gjennomført fusjon. Sletting ville tømt `bblId`
   * på kundene som var tilknyttet, og da kan ikke en årsberetning fra 2026 lenger si hvem
   * laget var tilknyttet den gang.
   */
  successorId: varchar("successor_id").references((): AnyPgColumn => bbl.id),
  mergeDate: date("merge_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Bbl = typeof bbl.$inferSelect;
