/**
 * Boligbyggelag — globalt register (BL-85).
 *
 * Står i `UNNTATT` i rls/tables.ts, og det er ikke en forglemmelse: registeret eies ikke av
 * noen kunde. Flere borettslag kan være tilknyttet samme lag, og lagene føres uavhengig av
 * om noen kunde bruker dem. En org-policy her ville betydd at laget forsvant så snart man
 * så på det uten org-kontekst — altså alltid, siden bare plattformpanelet skriver hit.
 */

import { boolean, date, pgEnum, pgTable, timestamp, varchar, text, type AnyPgColumn } from "drizzle-orm/pg-core";
import { FYLKESNR } from "../../lib/fylker";

/**
 * Fylkesnummer (SSB). Lista og navnene bor i den importfrie `lib/fylker.ts`. Ekte
 * Postgres-enum, som `orgformenum`: et nytt fylke krever `ALTER TYPE fylkeenum ADD VALUE` i
 * en migrasjon, ikke bare en ny oppføring der.
 */
export const fylkeEnum = pgEnum("fylkeenum", FYLKESNR);

export const bbl = pgTable("bbl", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  /** Lagres uten mellomrom — se `normaliserOrgnr` i lib/bbl.ts. */
  orgNr: varchar("org_nr").unique(),
  /**
   * Fritekst fra før fylkeslista (se `lib/fylker.ts`). Blir stående til verdiene som ikke
   * lot seg tolke i migrasjon 0069 er rettet; vises i panelet som «Ukjent». Skrives ikke lenger.
   */
  region: varchar("region"),
  /** Fylkesnummer (SSB), ett eller flere — et boligbyggelag dekker ofte flere fylker. */
  countyCodes: fylkeEnum("county_codes").array(),
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
