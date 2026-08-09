import { date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { completions, tasks } from "./tasks";
import { units } from "./units";
import { users } from "./users";
import { vendors } from "./vendors";

/**
 * Et selvstendig avvik. Kan opprettes manuelt eller automatisk fra en utkvittering.
 *
 * `roundId`/`roundItemId` fra v1 er IKKE med: de peker på `safety_rounds`, som hører til
 * Internkontroll og ikke er portert. De legges til når den modulen kommer — en nullbar
 * kolonne som mangler er lettere å oppdage enn en som finnes og aldri fylles.
 */
export const deviations = pgTable("deviations", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  /** Løpenummer per org, tildelt ved opprettelse. Det kunden refererer til i møter. */
  number: integer("number"),
  taskId: varchar("task_id").references(() => tasks.id),
  completionId: varchar("completion_id").references(() => completions.id),
  vendorId: varchar("vendor_id").references(() => vendors.id),
  /** Valgfritt med vilje: avvik i fellesarealer hører ikke til noen enhet, og et tomt felt
   *  skal ikke føles som en mangel. */
  unitId: varchar("unit_id").references(() => units.id),
  title: varchar("title").notNull(),
  description: text("description"),
  category: varchar("category"),
  /** lav | middels | akutt. Nullbar: avvik meldt manuelt fra appen spør ikke om det. */
  severity: varchar("severity"),
  /** ny | under_behandling | lukket. Lukking skjer KUN via lukk-handlingen. */
  status: varchar("status").notNull().default("ny"),
  reportedBy: varchar("reported_by").notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * `responsibleUserId` er SANNHETEN — den brukes til varsling og «mine avvik».
   * `assignedTo` er navnet, med to jobber: sorteringsnøkkel i avvikslista, og bærer av gamle
   * rader der ansvarlig var fritekst uten treff blant brukerne. Ved lesing vinner brukerens
   * NÅVÆRENDE navn, så et navnebytte ikke gir feil visning.
   */
  responsibleUserId: varchar("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  assignedTo: varchar("assigned_to"),
  dueDate: date("due_date"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: varchar("resolved_by"),
  resolutionNotes: text("resolution_notes"),
});

/**
 * Ett innlegg i behandlingsjournalen — «hva gjør vi med saken».
 *
 * Append-only: innlegg kan verken endres eller slettes i ettertid. Beskrivelse + behandling
 * + løsning er dokumentasjonskjeden som havner i internkontrollpermen (§ 5 pkt. 7), og den
 * er bare troverdig hvis den står som den ble skrevet. Derfor finnes det heller ingen
 * endre- eller slett-funksjoner for denne tabellen.
 */
export const deviationTreatments = pgTable("deviation_treatments", {
  id: varchar("id").primaryKey(),
  deviationId: varchar("deviation_id")
    .notNull()
    .references(() => deviations.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Endringslogg. Skrives av systemet, aldri av brukeren direkte. */
export const deviationLogs = pgTable("deviation_logs", {
  id: varchar("id").primaryKey(),
  deviationId: varchar("deviation_id")
    .notNull()
    .references(() => deviations.id, { onDelete: "cascade" }),
  changedBy: varchar("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  event: varchar("event").notNull(),
});

export type Deviation = typeof deviations.$inferSelect;
export type DeviationTreatment = typeof deviationTreatments.$inferSelect;
export type DeviationLog = typeof deviationLogs.$inferSelect;
