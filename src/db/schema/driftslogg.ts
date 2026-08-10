import { date, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { vendors } from "./vendors";

/**
 * Manuell loggføring i Driftslogg.
 *
 * Resten av loggen (oppgaver, avvik, vedlikehold, vernerunde) hentes fra sine egne moduler
 * ved lesing og lagres ikke her — kun det som ikke registreres noe annet sted trenger en rad.
 *
 * `createdBy` er navnet kopiert inn, ikke en peker til brukeren. Historikk skal ikke kunne
 * endres i ettertid: bytter noen navn, eller slettes brukeren, skal loggen fortsatt vise hvem
 * som førte den. Samme prinsipp som `CompletionChecklistResult` og `supportAccessLog.adminName`.
 */
export const logEntries = pgTable("log_entries", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").references(() => vendors.id),
  title: varchar("title").notNull(),
  description: text("description"),
  entryDate: date("entry_date").notNull(),
  createdBy: varchar("created_by").notNull(),
  /**
   * Den som førte linja, som id — ved siden av navnet, ikke i stedet for det. Navnet blir
   * stående uansett; id-en er der for at «min aktivitet» skal overleve et navnebytte. Se
   * kommentaren på `completions.completedByUserId`.
   */
  createdByUserId: varchar("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LogEntry = typeof logEntries.$inferSelect;
