import { boolean, date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { contracts } from "./kontrakter";
import { documents } from "./dokumenter";
import { organizations } from "./organizations";
import { tasks } from "./tasks";
import { vendors } from "./vendors";

/**
 * Rutine/prosedyre — dokumenterer HVORDAN noe skal gjøres, ikke når (det er oppgavens jobb).
 *
 * `status` er kun arbeidsflyten utkast/publisert. Om en publisert rutine fremstår som «aktiv»
 * eller «trenger gjennomgang» REGNES UT av `effektivStatus()` fra `lastReviewedAt` — det skal
 * ikke kunne settes manuelt, ellers mister revisjonsvarselet poenget sitt.
 */
export const routines = pgTable("routines", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: varchar("title").notNull(),
  description: text("description"),
  category: varchar("category"),
  /** Fri tekst: «Styret», «Vaktmester», «Beboer → Styret», «Alle». */
  responsible: varchar("responsible"),
  appliesTo: varchar("applies_to"),
  /** Akuttrutine — vises fremhevet. */
  isCritical: boolean("is_critical").notNull().default(false),
  /**
   * Hvor ofte rutinen skal revideres, i måneder. NULL = ingen påminnelse; rutinen flagges
   * da aldri som «trenger gjennomgang».
   */
  reviewIntervalMonths: integer("review_interval_months").default(12),
  /** `utkast` | `publisert`. */
  status: varchar("status").notNull().default("utkast"),
  lastReviewedAt: date("last_reviewed_at"),
  version: integer("version").notNull().default(1),
  /** Rutinen kan henges opp med QR-kode, som oppgaver. */
  qrToken: varchar("qr_token").unique(),
  vendorId: varchar("vendor_id").references(() => vendors.id),
  contractId: varchar("contract_id").references(() => contracts.id),
  documentId: varchar("document_id").references(() => documents.id),
  taskId: varchar("task_id").references(() => tasks.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ett nummerert steg.
 *
 * `calloutType: "contact"` løses LIVE mot rutinens leverandør sin primærkontakt ved lesing —
 * den kopieres bevisst ikke inn. Kontaktinfo skal hentes fra Leverandører-modulen, ikke
 * fryses i teksten: bytter vaktmesterfirmaet telefonnummer, skal rutinen vise det nye.
 * Dette er det ene stedet i systemet der historikk-prinsippet er snudd, og det er med vilje.
 */
export const routineSteps = pgTable("routine_steps", {
  id: varchar("id").primaryKey(),
  routineId: varchar("routine_id")
    .notNull()
    .references(() => routines.id, { onDelete: "cascade" }),
  order: integer("order").notNull().default(0),
  title: varchar("title").notNull(),
  description: text("description"),
  isCritical: boolean("is_critical").notNull().default(false),
  /** `warning` | `contact` | NULL. */
  calloutType: varchar("callout_type"),
  /** Kun brukt for `warning` — `contact` har ingen lagret tekst. */
  calloutText: text("callout_text"),
});

/**
 * Snapshot av rutinens forrige tilstand, tatt FØR en innholdsendring skrives.
 *
 * Viktig for HMS-dokumentasjon: ved tilsyn kan styret vise hvilken rutine som gjaldt på et
 * gitt tidspunkt. Derfor er raden uforanderlig — ingen endre- eller slett-funksjon.
 */
export const routineVersions = pgTable("routine_versions", {
  id: varchar("id").primaryKey(),
  routineId: varchar("routine_id")
    .notNull()
    .references(() => routines.id, { onDelete: "cascade" }),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  /** JSON: metadata + steps[] slik de var på tidspunktet. */
  contentSnapshot: text("content_snapshot").notNull(),
  /** Navn-snapshot, ikke fremmednøkkel. */
  changedBy: varchar("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Routine = typeof routines.$inferSelect;
export type RoutineStep = typeof routineSteps.$inferSelect;
export type RoutineVersion = typeof routineVersions.$inferSelect;
