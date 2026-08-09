import { boolean, date, integer, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { units } from "./units";
import { vendors } from "./vendors";

/**
 * Hvor ofte en oppgave skal utføres.
 *
 * NB: dette er en ekte Postgres-enum. Nye verdier krever `ALTER TYPE ... ADD VALUE`, ikke bare
 * en ny streng her — og dagtallet må inn i frekvenstabellen SAMTIDIG. Mangler det, blir
 * oppgaven stille aldri forsinket. Det er samme fella som i v1, og den overlever porten.
 */
export const frequencyEnum = pgEnum("frequencyenum", [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "every_3_years",
  "every_5_years",
  "every_8_years",
  "on_demand",
]);

/** Oppgave. Direkte tenant-tabell — RLS-policy på org_id. */
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: varchar("vendor_id")
    .notNull()
    .references(() => vendors.id),
  responsibleUserId: varchar("responsible_user_id").references(() => users.id),
  title: varchar("title").notNull(),
  description: text("description"),
  /** Historisk fritekst. Nye oppgaver peker på fellesareal via unit_id. */
  location: varchar("location"),
  frequency: frequencyEnum("frequency").notNull(),
  startDate: date("start_date"),
  /**
   * Frist for FØRSTE utførelse, og bare den. Ingen utkvittering → forsinket når fristen er
   * passert (også for `on_demand`, som ellers aldri kan bli forsinket). Etter første
   * utkvittering styrer frekvensen som før.
   */
  dueDate: date("due_date"),
  /**
   * Trykt på fysiske oppslag i bygget. Endres den, må hvert oppslag printes og henges opp
   * på nytt — migreringsskriptet verifiserer at den er uendret.
   */
  qrToken: varchar("qr_token").unique(),
  active: boolean("active").notNull().default(true),
  showOnArshjul: boolean("show_on_arshjul").notNull().default(false),
  /** Strukturert sted. Erstatter fritekstfeltet `location` for nye oppgaver. */
  unitId: varchar("unit_id").references(() => units.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Malpunkt på en oppgave. Barnetabell UTEN egen org_id — isoleres gjennom `tasks` via
 * EXISTS-policyen i rls/tables.ts. Selve avhukingen lagres per utførelse.
 */
export const taskChecklistItems = pgTable("task_checklist_items", {
  id: varchar("id").primaryKey(),
  taskId: varchar("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  text: varchar("text").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Én utførelse av en oppgave. Kommer fra QR-skjemaet, leverandørportalen eller manuelt fra
 * styret i appen. Barnetabell uten egen `org_id` — isoleres gjennom `tasks`.
 */
export const completions = pgTable("completions", {
  id: varchar("id").primaryKey(),
  taskId: varchar("task_id")
    .notNull()
    .references(() => tasks.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  /** Navnet kopiert inn, ikke en peker. Historikk skal ikke endres i ettertid. */
  completedBy: varchar("completed_by").notNull(),
  notes: text("notes"),
  hasDeviation: boolean("has_deviation").notNull().default(false),
  deviationDescription: text("deviation_description"),
  /** Registrert av styret i appen, ikke via QR-skjemaet. Loggen viser kilden ærlig. */
  manual: boolean("manual").notNull().default(false),
});

/**
 * Avhuking av ett sjekkpunkt ved én utførelse.
 *
 * Teksten KOPIERES fra malen ved innsending. Malpunktet kan endres eller slettes uten at
 * gammel logg endrer seg — derfor er `itemId` nullbar med SET NULL. Dette er mønsteret for
 * all historikk i systemet.
 */
export const completionChecklistResults = pgTable("completion_checklist_results", {
  id: varchar("id").primaryKey(),
  completionId: varchar("completion_id")
    .notNull()
    .references(() => completions.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").references(() => taskChecklistItems.id, { onDelete: "set null" }),
  text: varchar("text").notNull(),
  checked: boolean("checked").notNull().default(false),
  order: integer("order").notNull().default(0),
});

export type Task = typeof tasks.$inferSelect;
export type TaskChecklistItem = typeof taskChecklistItems.$inferSelect;
export type Completion = typeof completions.$inferSelect;
export type CompletionChecklistResult = typeof completionChecklistResults.$inferSelect;
