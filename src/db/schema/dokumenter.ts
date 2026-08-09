import { boolean, date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * En mappe kunden har laget selv. De seks standardmappene ligger IKKE her — de er
 * konstanter i `lib/dokumenter.ts` og kan ikke endres eller slettes av kunden.
 *
 * `parentId` er NULL (toppnivå), ELLER en standard-slug («styrereferater»), ELLER id-en til
 * en annen mappe. Samme «slug eller id»-mønster som `documents.folder`, slik at egne mapper
 * også kan ligge inne i standardmappene. Derfor ingen fremmednøkkel — sletting av undertreet
 * gjøres eksplisitt.
 */
export const documentFolders = pgTable("document_folders", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  parentId: varchar("parent_id"),
  name: varchar("name").notNull(),
  icon: varchar("icon").notNull().default("📁"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Et dokument i arkivet. Fila ligger under `uploads/orgs/{orgId}/documents`. */
export const documents = pgTable("documents", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /**
   * Standard-slug ELLER id-en til en egen mappe. Bevisst én kolonne uten fremmednøkkel.
   * Prisen er at sletting av en egen mappe må flytte dokumentene eksplisitt, ellers blir de
   * hengende i tomme lufta.
   */
  folder: varchar("folder").notNull().default("annet"),
  /**
   * Dokumentets egen dato, uavhengig av når fila ble lastet opp — et gammelt referat kan
   * lastes opp i dag. Styrer årsgrupperingen, og lar et feil årstall rettes i ettertid.
   */
  documentDate: date("document_date"),
  title: varchar("title").notNull(),
  description: text("description"),
  /** Lagret filnavn på disk (uuid-basert). */
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  contentType: varchar("content_type").notNull(),
  /** Teller mot lagringskvoten — tabellen står i `FILTABELLER`. */
  fileSize: integer("file_size"),
  uploadedBy: varchar("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Opt-in for AI-rådgiveren, samme mekanisme som `contracts.aiReadable`. Tenkt for
   * vedtekter o.l. — protokoller med persondata bør styret tenke seg om på.
   */
  aiReadable: boolean("ai_readable").notNull().default(false),
});

export type DocumentFolder = typeof documentFolders.$inferSelect;
export type Document = typeof documents.$inferSelect;
