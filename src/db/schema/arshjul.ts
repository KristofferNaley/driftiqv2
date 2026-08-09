import { boolean, date, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Manuelt lagt til hendelse på årshjulet (dugnad, budsjett, frist, annet).
 *
 * Oppgaver og internkontroll-frister hentes automatisk fra sine egne moduler ved lesing —
 * kun de manuelle kategoriene lagres her. Samme mønster som Driftslogg.
 */
export const annualEvents = pgTable("annual_events", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: varchar("title").notNull(),
  description: varchar("description"),
  category: varchar("category").notNull().default("annet"),
  /**
   * Valgfri start på en periode. `eventDate` er ALLTID slutten (fristen/dagen det skjer):
   * på tidslinjen tegnes hendelser med startdato som en bar fra start til frist, og
   * hendelser uten som et punkt PÅ datoen.
   */
  startDate: date("start_date"),
  eventDate: date("event_date").notNull(),
  /** Gjentar seg samme dato hvert år. */
  isRecurring: boolean("is_recurring").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AnnualEvent = typeof annualEvents.$inferSelect;
