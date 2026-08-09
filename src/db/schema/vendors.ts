import { boolean, date, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/**
 * Leverandør.
 *
 * v1s `contact_name`/`contact_email`/`contact_phone` er IKKE med: de ble erstattet av
 * `vendorContacts` (flere kontaktpersoner per leverandør) og sto igjen i v1 kun for
 * historiske rader som API-et sluttet å lese. Migreringen tar dem over som en
 * primærkontakt i stedet, så ingenting går tapt og kolonnene forsvinner.
 */
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name").notNull(),
  active: boolean("active").notNull().default(true),
  /**
   * Styrer hvilken gruppe og hvilke felter leverandøren vises med: `avtale`
   * (kontrakter/oppgaver), `handelskonto` (kundenr/EHF/siste kjøp), `adhoc` (sist brukt).
   * Fri tekst, ikke enum — samme mønster som `contracts.category`.
   */
  relationshipType: varchar("relationship_type").notNull().default("avtale"),
  /** Fagfelt, f.eks. «Elektro», «Heis». Fri tekst. */
  category: varchar("category"),
  customerNumber: varchar("customer_number"),
  ehf: boolean("ehf").notNull().default(false),
  /** Siste kjøp (handelskonto) / sist brukt (adhoc). */
  lastUsedAt: date("last_used_at"),
  notes: text("notes"),
  orgNumber: varchar("org_number"),
  /** Fakturamerknad, f.eks. leilighetsnummer hos leverandøren. */
  invoiceReference: varchar("invoice_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Kontaktperson. En leverandør kan ha flere, hver med sin egen rolle («Vaktmester»,
 * «Daglig leder»). Én kan merkes `isPrimary` for visning i kompakte oversikter.
 */
export const vendorContacts = pgTable("vendor_contacts", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: varchar("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  role: varchar("role"),
  email: varchar("email"),
  phone: varchar("phone"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fysisk nøkkel eller adgangskort utlevert til en leverandør.
 * Status er fri tekst: `utlevert` | `bør_sjekkes` | `innlevert`.
 */
export const vendorAccessItems = pgTable("vendor_access_items", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: varchar("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  title: varchar("title").notNull(),
  description: text("description"),
  /** Kommaseparerte tagger, f.eks. «Fellesboder,Teknisk rom». */
  areas: varchar("areas"),
  status: varchar("status").notNull().default("utlevert"),
  issuedTo: varchar("issued_to"),
  issuedAt: date("issued_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Datert notatlogg. `authorName` er et øyeblikksbilde av navnet til den som skrev notatet,
 * ikke en fremmednøkkel — historikk skal ikke endre seg om brukeren omdøpes eller slettes.
 */
export const vendorNotes = pgTable("vendor_notes", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: varchar("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  authorName: varchar("author_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vendor = typeof vendors.$inferSelect;
export type VendorContact = typeof vendorContacts.$inferSelect;
export type VendorAccessItem = typeof vendorAccessItems.$inferSelect;
export type VendorNote = typeof vendorNotes.$inferSelect;
