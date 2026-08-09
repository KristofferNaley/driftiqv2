import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Henvendelser fra landingssiden.
 *
 * Står i `UNNTATT` i rls/tables.ts: en lead har ingen `org_id` — den er nettopp noen som
 * ENNÅ ikke er kunde. RLS har ingenting å filtrere på, og tabellen er kun for plattformadmin.
 *
 * Skjemaet er offentlig og uautentisert. Beskyttelsen er en honningkrukke (se `leads.ts`),
 * ikke en innlogging — å kreve konto for å ta kontakt ville vært absurd.
 */
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  email: varchar("email").notNull(),
  phone: varchar("phone"),
  /** Borettslaget eller sameiet de sitter i. */
  company: varchar("company"),
  message: text("message"),
  /** ny | i_dialog | tilbud_sendt | konvertert | tapt */
  status: varchar("status").notNull().default("ny"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Lead = typeof leads.$inferSelect;
