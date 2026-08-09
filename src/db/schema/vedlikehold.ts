import { date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { units } from "./units";
import { vendors } from "./vendors";

/**
 * Et bygningselement i vedlikeholdsplanen (tak, fasade, rør, heis …).
 * Tilstandsgrad følger NS 3424 (TG0–TG3). Garantistatus utledes av `warrantyExpires`.
 */
export const buildingElements = pgTable("building_elements", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  icon: varchar("icon").notNull().default("🏗"),
  /** F.eks. «Avløpsrør — hele bygget». */
  category: varchar("category"),
  installedYear: integer("installed_year"),
  /** «TG0»..«TG3» etter NS 3424. */
  conditionGrade: varchar("condition_grade"),
  expectedLifetimeYears: integer("expected_lifetime_years"),
  /** Planlagt større tiltak — grunnlaget for tidslinje og budsjett. */
  nextActionYear: integer("next_action_year"),
  estimatedCost: integer("estimated_cost"),
  /** Installatør — kobling til leverandørregisteret. */
  vendorId: varchar("vendor_id").references(() => vendors.id),
  warrantyYears: integer("warranty_years"),
  warrantyExpires: date("warranty_expires"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * FDV-dokument på et bygningselement. `fdvType` er en fast slot som driver
 * komplett-prosenten — det er derfor den er en enum og ikke fri tekst.
 */
export const elementDocuments = pgTable("element_documents", {
  id: varchar("id").primaryKey(),
  elementId: varchar("element_id")
    .notNull()
    .references(() => buildingElements.id, { onDelete: "cascade" }),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fdvType: varchar("fdv_type").notNull().default("annet"),
  title: varchar("title").notNull(),
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  contentType: varchar("content_type").notNull(),
  fileSize: integer("file_size"),
  uploadedBy: varchar("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

/** En utført service/kontroll — vedlikeholdshistorikken på elementet. */
export const elementServices = pgTable("element_services", {
  id: varchar("id").primaryKey(),
  elementId: varchar("element_id")
    .notNull()
    .references(() => buildingElements.id, { onDelete: "cascade" }),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  serviceDate: date("service_date").notNull(),
  title: varchar("title").notNull(),
  performedBy: varchar("performed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Arbeid utført i ÉN enhet — bytte av sluk, våtrom, vinduer, sikringsskap.
 *
 * Hverken `elementServices` (hører til hele bygget), `tasks` (har frekvens og QR — et sluk
 * byttes én gang) eller `deviations` (noe som er GALT, dette er noe som er GJORT) passer.
 *
 * `workType` skiller vedlikehold fra påkostning: vedlikehold setter enheten tilbake til
 * tidligere standard og er en driftskostnad, påkostning hever standarden og skal aktiveres.
 * Skillet avgjør regnskapsføringen og er nesten umulig å rekonstruere fra en fritekst i
 * ettertid — derfor et eget felt og ikke en tolkning revisor må gjøre.
 *
 * `paidBy` er det andre feltet som ikke kan gjenskapes senere. Grensen mellom lagets og
 * andelseierens ansvar er den vanligste tvisten i et borettslag, og ved eierskifte er det
 * dette meglerpakken spør om.
 */
export const unitWorks = pgTable("unit_works", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Ingen ondelete: enheter arkiveres bløtt, aldri med kaskade. */
  unitId: varchar("unit_id")
    .notNull()
    .references(() => units.id),
  /**
   * Snapshot av enhetens identitet ved registrering, f.eks. «H0203 · oppg. B». En
   * omnummerering av registeret skal ikke omskrive hva som sto på oppføringen da den ble
   * skrevet — samme prinsipp som `completionChecklistResults.text`.
   */
  unitLabel: varchar("unit_label").notNull(),
  /**
   * SET NULL, ikke CASCADE: slettes bygningselementet skal historikken i enheten bli
   * stående. Koblingen lar planen vise «34 av 60 enheter utført» i stedet for ett
   * `nextActionYear` som skjuler at arbeidet er halvferdig.
   */
  elementId: varchar("element_id").references(() => buildingElements.id, { onDelete: "set null" }),
  category: varchar("category").notNull().default("annet"),
  workType: varchar("work_type").notNull().default("vedlikehold"),
  workDate: date("work_date").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  vendorId: varchar("vendor_id").references(() => vendors.id),
  /** Fritekst når arbeidet ikke ble gjort av en registrert leverandør. */
  performedBy: varchar("performed_by"),
  paidBy: varchar("paid_by").notNull().default("borettslag"),
  /** NOK, det laget faktisk betalte. */
  cost: integer("cost"),
  /** Navn-snapshot, ikke fremmednøkkel. */
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Dokumentasjon på arbeid i en enhet — bilder, faktura, samsvar, rapport. */
export const unitWorkDocuments = pgTable("unit_work_documents", {
  id: varchar("id").primaryKey(),
  workId: varchar("work_id")
    .notNull()
    .references(() => unitWorks.id, { onDelete: "cascade" }),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  docType: varchar("doc_type").notNull().default("annet"),
  title: varchar("title").notNull(),
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  contentType: varchar("content_type").notNull(),
  fileSize: integer("file_size"),
  uploadedBy: varchar("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BuildingElement = typeof buildingElements.$inferSelect;
export type ElementDocument = typeof elementDocuments.$inferSelect;
export type ElementService = typeof elementServices.$inferSelect;
export type UnitWork = typeof unitWorks.$inferSelect;
export type UnitWorkDocument = typeof unitWorkDocuments.$inferSelect;
