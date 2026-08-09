import { date, integer, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
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
  qrToken: varchar("qr_token").unique(),
  createdAt: timestamp("created_at").defaultNow(),
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
  createdAt: timestamp("created_at").defaultNow(),
});

export type Task = typeof tasks.$inferSelect;
export type TaskChecklistItem = typeof taskChecklistItems.$inferSelect;
